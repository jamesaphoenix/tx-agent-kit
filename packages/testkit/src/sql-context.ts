import { context, trace } from '@opentelemetry/api'
import type { Effect } from 'effect'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { getTestkitEnv } from './env.js'
import {
  buildSchemaDatabaseUrl,
  buildSchemaName,
  createTestCaseId,
  createTestRunId,
  defaultTestDatabaseUrl
} from './test-run.js'

export interface CreateSqlTestContextOptions {
  testRunId?: string
  baseDatabaseUrl?: string
  schemaPrefix?: string
  repoRoot?: string
}

export interface SqlTestContext {
  testRunId: string
  schemaName: string
  baseDatabaseUrl: string
  schemaDatabaseUrl: string
  repoRoot: string
  setup: () => Promise<void>
  reset: () => Promise<void>
  teardown: () => Promise<void>
  withSchemaClient: <A>(callback: (client: Client) => Promise<A>) => Promise<A>
  headersForCase: (caseName: string, headers?: HeadersInit) => Record<string, string>
  withEffectContext: <A, E, R>(effect: Effect.Effect<A, E, R>, caseName: string) => Effect.Effect<A, E, R>
}

const migrationsRelativePath = 'packages/infra/db/drizzle/migrations'
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '::1'])

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`

const normalizeHeaders = (headers?: HeadersInit): Record<string, string> => {
  if (!headers) {
    return {}
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(',') : String(value)
    ])
  )
}

const resolveRepoRoot = (start = process.cwd()): string => {
  let current = resolve(start)

  while (true) {
    const migrationDir = resolve(current, migrationsRelativePath)
    const workspaceFile = resolve(current, 'pnpm-workspace.yaml')

    if (existsSync(migrationDir) && existsSync(workspaceFile)) {
      return current
    }

    const parent = resolve(current, '..')
    if (parent === current) {
      throw new Error(`Could not resolve repository root from ${start}`)
    }

    current = parent
  }
}

const assertSafeDatabaseUrl = (
  databaseUrl: string,
  allowUnsafeDatabaseUrl: boolean
): void => {
  if (allowUnsafeDatabaseUrl) {
    return
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(databaseUrl)
  } catch {
    throw new Error(`Invalid DATABASE_URL for test context: ${databaseUrl}`)
  }

  const host = parsedUrl.hostname.toLowerCase()
  if (localDatabaseHosts.has(host)) {
    return
  }

  throw new Error(
    [
      `Refusing to run integration DB operations against non-local host: ${host}.`,
      'Set TESTKIT_ALLOW_UNSAFE_DATABASE_URL=true to override intentionally.'
    ].join(' ')
  )
}

const getMigrationFiles = (repoRoot: string): ReadonlyArray<{ name: string; sql: string }> => {
  const migrationDir = resolve(repoRoot, migrationsRelativePath)
  const fileNames = readdirSync(migrationDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))

  return fileNames.map((name) => ({
    name,
    sql: readFileSync(resolve(migrationDir, name), 'utf8')
  }))
}

const createBaseClient = (baseDatabaseUrl: string): Client =>
  new Client({ connectionString: baseDatabaseUrl })

const ensureSchema = async (client: Client, schemaName: string): Promise<void> => {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`)
}

const setSearchPath = async (client: Client, schemaName: string): Promise<void> => {
  await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}, public`)
}

const ensureMigrationTable = async (client: Client): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS __tx_agent_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

const globalMigrationLockId = 4_602_001

const withGlobalMigrationLock = async <A>(
  client: Client,
  callback: () => Promise<A>
): Promise<A> => {
  await client.query('SELECT pg_advisory_lock($1)', [globalMigrationLockId])

  try {
    return await callback()
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [globalMigrationLockId])
  }
}

const seedIfPresent = async (client: Client, tableNames: ReadonlySet<string>): Promise<void> => {
  if (tableNames.has('roles')) {
    await client.query(`
      INSERT INTO roles (name)
      VALUES ('owner'), ('admin'), ('member')
      ON CONFLICT (name) DO NOTHING
    `)
  }

  if (tableNames.has('permissions')) {
    await client.query(`
      INSERT INTO permissions (key)
      VALUES ('organization.read'), ('organization.write'), ('organization.manage'), ('invite.manage')
      ON CONFLICT (key) DO NOTHING
    `)
  }
}

export const createSqlTestContext = (
  options: CreateSqlTestContextOptions = {}
): SqlTestContext => {
  const testRunId = options.testRunId ?? createTestRunId()
  const schemaName = buildSchemaName(testRunId, options.schemaPrefix ?? 'test')
  const testkitEnv = getTestkitEnv()
  const baseDatabaseUrl = options.baseDatabaseUrl ?? testkitEnv.DATABASE_URL ?? defaultTestDatabaseUrl
  const allowUnsafeDatabaseUrl = testkitEnv.TESTKIT_ALLOW_UNSAFE_DATABASE_URL === 'true'
  assertSafeDatabaseUrl(baseDatabaseUrl, allowUnsafeDatabaseUrl)
  const schemaDatabaseUrl = buildSchemaDatabaseUrl(baseDatabaseUrl, schemaName)
  const repoRoot = options.repoRoot ?? resolveRepoRoot()

  const withBaseClient = async <A>(callback: (client: Client) => Promise<A>): Promise<A> => {
    const client = createBaseClient(baseDatabaseUrl)
    await client.connect()

    try {
      return await callback(client)
    } finally {
      await client.end()
    }
  }

  const withSchemaClient = async <A>(callback: (client: Client) => Promise<A>): Promise<A> =>
    withBaseClient(async (client) => {
      await ensureSchema(client, schemaName)
      await setSearchPath(client, schemaName)
      await ensureMigrationTable(client)
      return callback(client)
    })

  const setup = async (): Promise<void> => {
    const migrationFiles = getMigrationFiles(repoRoot)

    await withSchemaClient(async (client) => {
      await withGlobalMigrationLock(client, async () => {
        const applied = await client.query<{ name: string }>('SELECT name FROM __tx_agent_migrations')
        const appliedSet = new Set(applied.rows.map((row) => row.name))

        for (const migration of migrationFiles) {
          if (appliedSet.has(migration.name)) {
            continue
          }

          await client.query('BEGIN')
          try {
            await client.query(migration.sql)
            await client.query('INSERT INTO __tx_agent_migrations (name) VALUES ($1)', [migration.name])
            await client.query('COMMIT')
          } catch (error) {
            await client.query('ROLLBACK')
            throw error
          }
        }
      })
    })

    await reset()
  }

  const reset = async (): Promise<void> => {
    await withSchemaClient(async (client) => {
      // Fail fast on lock contention instead of hanging integration suites.
      await client.query(`SET lock_timeout TO '5s'`)
      await client.query(`SET statement_timeout TO '30s'`)

      const tables = await client.query<{ tablename: string }>(
        `
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = $1
            AND tablename <> '__tx_agent_migrations'
        `,
        [schemaName]
      )

      const tableNames = new Set(tables.rows.map((row) => row.tablename))
      if (tables.rows.length > 0) {
        const qualified = tables.rows
          .map((row) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(row.tablename)}`)
          .join(', ')

        await client.query(`TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`)
      }

      await seedIfPresent(client, tableNames)
    })
  }

  const teardown = async (): Promise<void> => {
    await withBaseClient(async (client) => {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
    })
  }

  const headersForCase = (caseName: string, headers?: HeadersInit): Record<string, string> => {
    const testCaseId = createTestCaseId(testRunId, caseName)
    return {
      ...normalizeHeaders(headers),
      'x-test-run-id': testRunId,
      'x-test-case-id': testCaseId
    }
  }

  const withEffectContext = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    caseName: string
  ): Effect.Effect<A, E, R> => {
    const testCaseId = createTestCaseId(testRunId, caseName)
    const activeSpan = trace.getSpan(context.active())

    if (activeSpan) {
      activeSpan.setAttribute('test.run_id', testRunId)
      activeSpan.setAttribute('test.case_id', testCaseId)
    }

    return effect
  }

  return {
    testRunId,
    schemaName,
    baseDatabaseUrl,
    schemaDatabaseUrl,
    repoRoot,
    setup,
    reset,
    teardown,
    withSchemaClient,
    headersForCase,
    withEffectContext
  }
}
