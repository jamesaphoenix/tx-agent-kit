import { context, trace } from '@opentelemetry/api'
import {
  applySqlFiles,
  applySqlMigration,
  ensureMigrationTable,
  getMigrationFiles,
  getSchemaFiles,
  resolveRepoRoot,
  type SqlFile
} from '@tx-agent-kit/db'
import type { Effect } from 'effect'
import { Client } from 'pg'
import { getTestkitEnv } from './env.js'
import { filterResettableTableNames } from './reset-plan.js'
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
  resetStrategy?: 'per-test' | 'deferred'
}

export interface SqlTestContext {
  testRunId: string
  schemaName: string
  baseDatabaseUrl: string
  schemaDatabaseUrl: string
  repoRoot: string
  resetStrategy: 'per-test' | 'deferred'
  setup: () => Promise<void>
  reset: () => Promise<void>
  flushReset: () => Promise<void>
  teardown: () => Promise<void>
  withSchemaClient: <A>(callback: (client: Client) => Promise<A>) => Promise<A>
  headersForCase: (caseName: string, headers?: HeadersInit) => Record<string, string>
  withEffectContext: <A, E, R>(effect: Effect.Effect<A, E, R>, caseName: string) => Effect.Effect<A, E, R>
}

export type SqlMigrationFile = SqlFile

const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '::1'])
const globalMigrationLockId = 4_602_001
const sharedMigrationNameSet = new Set([
  '0001_core_saas.sql',
  '0015_restore_public_invitation_identity_trigger.sql',
  '0016_ensure_invitation_identity_trigger_all_schemas.sql'
])
const sharedMigrationPatterns = [
  /\bcreate extension\b/iu,
  /\balter extension\b/iu,
  /\bdrop extension\b/iu,
  /\bpublic\./iu
]
const dropFunctionPattern =
  /(DROP FUNCTION IF EXISTS\s+)(?:(("(?:""|[^"])+?"|[A-Za-z_][A-Za-z0-9_$]*))\s*\.\s*)?((?:"(?:""|[^"])+?"|[A-Za-z_][A-Za-z0-9_$]*))(\s*\(\s*\)\s*CASCADE\s*;)/giu

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`

export const scopeUnqualifiedFunctionDropsToSchema = (
  sql: string,
  schemaName: string
): string =>
  sql.replaceAll(
    dropFunctionPattern,
    (
      statement: string,
      prefix: string,
      schemaQualifier: string | undefined,
      _schemaIdentifier: string | undefined,
      functionName: string,
      suffix: string
    ) => {
      if (schemaQualifier) {
        return statement
      }

      return `${prefix}${quoteIdentifier(schemaName)}.${functionName}${suffix}`
    }
  )

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
      Array.isArray(value) ? value.join(',') : value
    ])
  )
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

const createBaseClient = (baseDatabaseUrl: string): Client =>
  new Client({ connectionString: baseDatabaseUrl })

export const migrationRequiresGlobalLock = (migration: SqlMigrationFile): boolean => {
  if (sharedMigrationNameSet.has(migration.name)) {
    return true
  }

  return sharedMigrationPatterns.some((pattern) => pattern.test(migration.sql))
}

const ensureSchema = async (client: Client, schemaName: string): Promise<void> => {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`)
}

const setSearchPath = async (client: Client, schemaName: string): Promise<void> => {
  // Include DATABASE_SCHEMA (set by worktree setup.sh to e.g. `wt_<name>`) in the
  // fallback chain so direct-SQL test seeds fall through to the shared schema
  // where the running API server actually reads/writes. Without this, tests on
  // worktrees that do `withSchemaClient(INSERT ...)` land the rows in an empty
  // sub-schema while the API is looking at `wt_<name>`.
  const fallbackSchema = getTestkitEnv().DATABASE_SCHEMA
  const identifiers = [quoteIdentifier(schemaName)]
  if (fallbackSchema && fallbackSchema !== schemaName && fallbackSchema !== 'public') {
    identifiers.push(quoteIdentifier(fallbackSchema))
  }
  identifiers.push('public')
  await client.query(`SET search_path TO ${identifiers.join(', ')}`)
}

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

export const createSqlTestContext = (
  options: CreateSqlTestContextOptions = {}
): SqlTestContext => {
  const testRunId = options.testRunId ?? createTestRunId()
  const schemaName = buildSchemaName(testRunId, options.schemaPrefix ?? 'test')
  const resetStrategy = options.resetStrategy ?? 'per-test'
  const testkitEnv = getTestkitEnv()
  const baseDatabaseUrl = options.baseDatabaseUrl ?? testkitEnv.DATABASE_URL ?? defaultTestDatabaseUrl
  const allowUnsafeDatabaseUrl = testkitEnv.TESTKIT_ALLOW_UNSAFE_DATABASE_URL === 'true'
  assertSafeDatabaseUrl(baseDatabaseUrl, allowUnsafeDatabaseUrl)
  const schemaDatabaseUrl = buildSchemaDatabaseUrl(baseDatabaseUrl, schemaName)
  const repoRoot = options.repoRoot ?? resolveRepoRoot()
  const schemaFiles = getSchemaFiles(repoRoot)
  let mutableTableNames: ReadonlyArray<string> | null = null

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
      return await callback(client)
    })

  const resolveMutableTableNames = async (client: Client): Promise<ReadonlyArray<string>> => {
    if (mutableTableNames !== null) {
      return mutableTableNames
    }

    const tables = await client.query<{ tablename: string }>(
      `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = $1
      `,
      [schemaName]
    )

    mutableTableNames = filterResettableTableNames(
      tables.rows.map((row) => row.tablename)
    )

    return mutableTableNames
  }

  const setup = async (): Promise<void> => {
    const migrationFiles = getMigrationFiles(repoRoot)

    await withSchemaClient(async (client) => {
      const applied = await client.query<{ name: string }>('SELECT name FROM __tx_agent_migrations')
      const appliedSet = new Set(applied.rows.map((row) => row.name))

      for (const migration of migrationFiles) {
        if (appliedSet.has(migration.name)) {
          continue
        }

        const scopedMigration: SqlMigrationFile = {
          name: migration.name,
          sql: scopeUnqualifiedFunctionDropsToSchema(migration.sql, schemaName)
        }

        if (migrationRequiresGlobalLock(migration)) {
          await withGlobalMigrationLock(client, async () => applySqlMigration(client, scopedMigration))
        } else {
          await applySqlMigration(client, scopedMigration)
        }

        appliedSet.add(migration.name)
      }

      await applySqlFiles(client, schemaFiles)
      mutableTableNames = await resolveMutableTableNames(client)
    })

    await reset()
  }

  const performReset = async (): Promise<void> => {
    await withSchemaClient(async (client) => {
      // Fail fast on lock contention instead of hanging integration suites.
      await client.query(`SET lock_timeout TO '5s'`)
      await client.query(`SET statement_timeout TO '30s'`)

      const tableNames = await resolveMutableTableNames(client)

      if (tableNames.length > 0) {
        const qualified = tableNames
          .map((tableName) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`)
          .join(', ')

        await client.query(`TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`)
      }

      await applySqlFiles(client, schemaFiles)
    })
  }

  const reset = async (): Promise<void> => {
    if (resetStrategy === 'deferred') {
      return
    }
    await performReset()
  }

  const flushReset = async (): Promise<void> => {
    await performReset()
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
    resetStrategy,
    setup,
    reset,
    flushReset,
    teardown,
    withSchemaClient,
    headersForCase,
    withEffectContext
  }
}
