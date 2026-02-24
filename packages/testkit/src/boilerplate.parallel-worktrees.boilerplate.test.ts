import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  probeLongRunningCommandUntilReady,
  runCommand,
  type CommandReadyProbeResult
} from './command-entrypoints.js'
import { getTestkitEnv, getTestkitProcessEnv } from './env.js'
import { buildSchemaDatabaseUrl } from './test-run.js'
import {
  defaultWorktreeSetupDatabaseUrl,
  runWorktreeSetup,
  type WorktreeSetupResult
} from './worktree-setup.js'

interface WorktreeFixture {
  readonly name: string
  readonly setup: WorktreeSetupResult
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const migrateTimeoutMs = parsePositiveInt(
  process.env.BOILERPLATE_MIGRATE_TIMEOUT_MS,
  240_000
)
const probeTimeoutMs = parsePositiveInt(
  process.env.BOILERPLATE_DEV_PROBE_TIMEOUT_MS,
  45_000
)
const dualStackTimeoutMs = Math.max(180_000, probeTimeoutMs * 6)

const tempRootPath = mkdtempSync(resolve(tmpdir(), 'tx-agent-kit-boilerplate-'))
const worktreeNames = ['wt_boilerplate_alpha', 'wt_boilerplate_bravo'] as const
const fixtures: WorktreeFixture[] = []
const testkitEnv = getTestkitEnv()
const baseDatabaseUrl =
  testkitEnv.DATABASE_URL ?? defaultWorktreeSetupDatabaseUrl

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`

const requireEnvValue = (
  setup: WorktreeSetupResult,
  key: string
): string => {
  const value = setup.envValues[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required worktree env key '${key}'`)
  }

  return value
}

const parseCount = (value: string | number | undefined): number => {
  if (typeof value === 'number') {
    return value
  }

  const parsed = Number.parseInt(value ?? '0', 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value: ${String(value)}`)
  }

  return parsed
}

const withDbClient = async <A>(callback: (client: Client) => Promise<A>): Promise<A> => {
  const client = new Client({
    connectionString: baseDatabaseUrl
  })

  await client.connect()
  try {
    return await callback(client)
  } finally {
    await client.end()
  }
}

const schemaExists = async (schemaName: string): Promise<boolean> =>
  withDbClient(async (client) => {
    const result = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.schemata
          WHERE schema_name = $1
        ) AS exists
      `,
      [schemaName]
    )

    return result.rows[0]?.exists === true
  })

const tableExists = async (
  schemaName: string,
  tableName: string
): Promise<boolean> =>
  withDbClient(async (client) => {
    const result = await client.query<{ count: string | number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = $2
      `,
      [schemaName, tableName]
    )

    return parseCount(result.rows[0]?.count) === 1
  })

const countTableRows = async (
  schemaName: string,
  tableName: string
): Promise<number> =>
  withDbClient(async (client) => {
    const result = await client.query<{ count: string | number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}
      `
    )

    return parseCount(result.rows[0]?.count)
  })

const insertUserSentinel = async (
  schemaName: string,
  email: string
): Promise<void> => {
  await withDbClient(async (client) => {
    await client.query(
      `
        INSERT INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier('users')}
          (id, email, password_hash, name)
        VALUES
          ($1, $2, 'boilerplate-hash', 'Boilerplate Sentinel')
      `,
      [randomUUID(), email]
    )
  })
}

const countUsersByEmail = async (
  schemaName: string,
  email: string
): Promise<number> =>
  withDbClient(async (client) => {
    const result = await client.query<{ count: string | number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier('users')}
        WHERE email = $1
      `,
      [email]
    )

    return parseCount(result.rows[0]?.count)
  })

const buildDevEnvironment = (
  setup: WorktreeSetupResult,
  authSecret: string
): NodeJS.ProcessEnv => {
  const webPort = requireEnvValue(setup, 'WEB_PORT')
  const apiPort = requireEnvValue(setup, 'API_PORT')
  const mobilePort = requireEnvValue(setup, 'MOBILE_PORT')
  const workerInspectPort = requireEnvValue(setup, 'WORKER_INSPECT_PORT')
  const schemaName = requireEnvValue(setup, 'DATABASE_SCHEMA')
  const databaseUrl = buildSchemaDatabaseUrl(baseDatabaseUrl, schemaName)
  const apiBaseUrl = requireEnvValue(setup, 'API_BASE_URL')
  const taskQueue = requireEnvValue(setup, 'TEMPORAL_TASK_QUEUE')

  return {
    NODE_ENV: 'development',
    API_HOST: '127.0.0.1',
    API_PORT: apiPort,
    API_BASE_URL: apiBaseUrl,
    API_CORS_ORIGIN: `http://127.0.0.1:${webPort}`,
    NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
    EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: authSecret,
    WEB_PORT: webPort,
    PORT: webPort,
    MOBILE_PORT: mobilePort,
    WORKER_INSPECT_PORT: workerInspectPort,
    TEMPORAL_RUNTIME_MODE: 'cli',
    TEMPORAL_ADDRESS: 'localhost:7233',
    TEMPORAL_NAMESPACE: 'default',
    TEMPORAL_TASK_QUEUE: taskQueue,
    TEMPORAL_TLS_ENABLED: 'false',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4320',
    OTEL_LOGS_EXPORTER: 'otlp'
  }
}

const probeOutput = (result: CommandReadyProbeResult): string =>
  `${result.stdout}\n${result.stderr}`

const assertProbe = (
  result: CommandReadyProbeResult,
  signalPattern: RegExp,
  label: string
): void => {
  const output = probeOutput(result)
  expect(output, `${label} startup output`).toMatch(signalPattern)
  expect(result.readinessMatched, `${label} readiness`).toBe(true)
  expect(result.timedOut, `${label} timed out`).toBe(false)
  expect(output, `${label} port collision`).not.toMatch(/EADDRINUSE|address already in use/iu)
}

beforeAll(() => {
  for (const worktreeName of worktreeNames) {
    fixtures.push({
      name: worktreeName,
      setup: runWorktreeSetup(worktreeName, tempRootPath, baseDatabaseUrl)
    })
  }
})

afterAll(() => {
  const cleanupFailures: string[] = []

  for (const fixture of fixtures) {
    const resetScriptPath = resolve(fixture.setup.path, 'reset-worktree-schema.sh')

    if (!existsSync(resetScriptPath)) {
      continue
    }

    try {
      execFileSync('bash', [resetScriptPath], {
        cwd: fixture.setup.path,
        env: getTestkitProcessEnv(),
        stdio: 'pipe'
      })
    } catch (error) {
      cleanupFailures.push(
        `${fixture.name}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  rmSync(tempRootPath, {
    recursive: true,
    force: true
  })

  if (cleanupFailures.length > 0) {
    throw new Error(
      `Failed to clean up one or more boilerplate worktrees:\n${cleanupFailures.join('\n')}`
    )
  }
})

describe.sequential('boilerplate parallel-worktree meta tests', () => {
  it(
    'creates isolated worktree schemas and runs migrations independently',
    async () => {
      const [firstFixture, secondFixture] = fixtures
      if (!firstFixture || !secondFixture) {
        throw new Error('Expected two boilerplate worktree fixtures')
      }

      const firstSchema = requireEnvValue(firstFixture.setup, 'DATABASE_SCHEMA')
      const secondSchema = requireEnvValue(secondFixture.setup, 'DATABASE_SCHEMA')
      const firstApiPort = requireEnvValue(firstFixture.setup, 'API_PORT')
      const secondApiPort = requireEnvValue(secondFixture.setup, 'API_PORT')
      const firstWebPort = requireEnvValue(firstFixture.setup, 'WEB_PORT')
      const secondWebPort = requireEnvValue(secondFixture.setup, 'WEB_PORT')
      const firstMobilePort = requireEnvValue(firstFixture.setup, 'MOBILE_PORT')
      const secondMobilePort = requireEnvValue(secondFixture.setup, 'MOBILE_PORT')
      const firstWorkerInspectPort = requireEnvValue(firstFixture.setup, 'WORKER_INSPECT_PORT')
      const secondWorkerInspectPort = requireEnvValue(secondFixture.setup, 'WORKER_INSPECT_PORT')
      const firstTaskQueue = requireEnvValue(firstFixture.setup, 'TEMPORAL_TASK_QUEUE')
      const secondTaskQueue = requireEnvValue(secondFixture.setup, 'TEMPORAL_TASK_QUEUE')
      const firstDatabaseUrl = buildSchemaDatabaseUrl(baseDatabaseUrl, firstSchema)
      const secondDatabaseUrl = buildSchemaDatabaseUrl(baseDatabaseUrl, secondSchema)

      expect(firstSchema).not.toBe(secondSchema)
      expect(firstApiPort).not.toBe(secondApiPort)
      expect(firstWebPort).not.toBe(secondWebPort)
      expect(firstMobilePort).not.toBe(secondMobilePort)
      expect(firstWorkerInspectPort).not.toBe(secondWorkerInspectPort)
      expect(firstTaskQueue).not.toBe(secondTaskQueue)

      const firstMigration = runCommand(
        'pnpm',
        ['db:migrate'],
        {
          DATABASE_URL: firstDatabaseUrl
        },
        migrateTimeoutMs
      )
      expect(firstMigration.exitCode).toBe(0)

      const secondMigration = runCommand(
        'pnpm',
        ['db:migrate'],
        {
          DATABASE_URL: secondDatabaseUrl
        },
        migrateTimeoutMs
      )
      expect(secondMigration.exitCode).toBe(0)

      expect(await schemaExists(firstSchema)).toBe(true)
      expect(await schemaExists(secondSchema)).toBe(true)
      expect(await tableExists(firstSchema, 'users')).toBe(true)
      expect(await tableExists(secondSchema, 'users')).toBe(true)
      expect(await tableExists(firstSchema, '__tx_agent_migrations')).toBe(true)
      expect(await tableExists(secondSchema, '__tx_agent_migrations')).toBe(true)

      const firstMigrationCount = await countTableRows(firstSchema, '__tx_agent_migrations')
      const secondMigrationCount = await countTableRows(secondSchema, '__tx_agent_migrations')
      expect(firstMigrationCount).toBeGreaterThan(0)
      expect(secondMigrationCount).toBe(firstMigrationCount)

      const firstEmail = `boilerplate-${randomUUID()}@example.com`
      await insertUserSentinel(firstSchema, firstEmail)

      const firstSchemaLocalCount = await countUsersByEmail(firstSchema, firstEmail)
      const secondSchemaCrossCount = await countUsersByEmail(secondSchema, firstEmail)
      expect(firstSchemaLocalCount).toBe(1)
      expect(secondSchemaCrossCount).toBe(0)

      const secondEmail = `boilerplate-${randomUUID()}@example.com`
      await insertUserSentinel(secondSchema, secondEmail)

      const secondSchemaLocalCount = await countUsersByEmail(secondSchema, secondEmail)
      const firstSchemaCrossCount = await countUsersByEmail(firstSchema, secondEmail)
      expect(secondSchemaLocalCount).toBe(1)
      expect(firstSchemaCrossCount).toBe(0)
    },
    migrateTimeoutMs + 60_000
  )

  it(
    'boots two isolated api/web/mobile/worker stacks without collisions',
    async () => {
      const [firstFixture, secondFixture] = fixtures
      if (!firstFixture || !secondFixture) {
        throw new Error('Expected two boilerplate worktree fixtures')
      }

      const firstEnv = buildDevEnvironment(firstFixture.setup, 'boilerplate-auth-secret-alpha')
      const secondEnv = buildDevEnvironment(secondFixture.setup, 'boilerplate-auth-secret-bravo')

      const [firstApiProbe, secondApiProbe] = await Promise.all([
        probeLongRunningCommandUntilReady(
          process.execPath,
          ['--import', 'tsx', 'apps/api/src/server.ts'],
          /Starting API server\./u,
          firstEnv,
          probeTimeoutMs
        ),
        probeLongRunningCommandUntilReady(
          process.execPath,
          ['--import', 'tsx', 'apps/api/src/server.ts'],
          /Starting API server\./u,
          secondEnv,
          probeTimeoutMs
        )
      ])
      assertProbe(firstApiProbe, /Starting API server\./u, 'api alpha')
      assertProbe(secondApiProbe, /Starting API server\./u, 'api bravo')

      const [firstWebProbe, secondWebProbe] = await Promise.all([
        probeLongRunningCommandUntilReady(
          'pnpm',
          ['--filter', '@tx-agent-kit/web', 'dev'],
          /Ready|started server|Local:\s*http:\/\/|Next\.js/u,
          firstEnv,
          probeTimeoutMs
        ),
        probeLongRunningCommandUntilReady(
          'pnpm',
          ['--filter', '@tx-agent-kit/web', 'dev'],
          /Ready|started server|Local:\s*http:\/\/|Next\.js/u,
          secondEnv,
          probeTimeoutMs
        )
      ])
      assertProbe(
        firstWebProbe,
        /Ready|started server|Local:\s*http:\/\/|Next\.js/u,
        'web alpha'
      )
      assertProbe(
        secondWebProbe,
        /Ready|started server|Local:\s*http:\/\/|Next\.js/u,
        'web bravo'
      )

      const [firstMobileProbe, secondMobileProbe] = await Promise.all([
        probeLongRunningCommandUntilReady(
          'pnpm',
          ['--filter', '@tx-agent-kit/mobile', 'dev'],
          /Starting project at|Waiting on http:\/\/localhost|Skipping dev server|EMFILE/u,
          firstEnv,
          probeTimeoutMs
        ),
        probeLongRunningCommandUntilReady(
          'pnpm',
          ['--filter', '@tx-agent-kit/mobile', 'dev'],
          /Starting project at|Waiting on http:\/\/localhost|Skipping dev server|EMFILE/u,
          secondEnv,
          probeTimeoutMs
        )
      ])
      assertProbe(
        firstMobileProbe,
        /Starting project at|Waiting on http:\/\/localhost|Skipping dev server|EMFILE/u,
        'mobile alpha'
      )
      assertProbe(
        secondMobileProbe,
        /Starting project at|Waiting on http:\/\/localhost|Skipping dev server|EMFILE/u,
        'mobile bravo'
      )
      expect(probeOutput(firstMobileProbe)).not.toMatch(/Use port [0-9]+ instead\?/u)
      expect(probeOutput(secondMobileProbe)).not.toMatch(/Use port [0-9]+ instead\?/u)

      const [firstWorkerProbe, secondWorkerProbe] = await Promise.all([
        probeLongRunningCommandUntilReady(
          process.execPath,
          ['--import', 'tsx', 'apps/worker/src/index.ts'],
          /Temporal worker started\./u,
          {
            ...firstEnv,
            NODE_OPTIONS: `--inspect=${requireEnvValue(firstFixture.setup, 'WORKER_INSPECT_PORT')}`
          },
          probeTimeoutMs
        ),
        probeLongRunningCommandUntilReady(
          process.execPath,
          ['--import', 'tsx', 'apps/worker/src/index.ts'],
          /Temporal worker started\./u,
          {
            ...secondEnv,
            NODE_OPTIONS: `--inspect=${requireEnvValue(secondFixture.setup, 'WORKER_INSPECT_PORT')}`
          },
          probeTimeoutMs
        )
      ])
      assertProbe(
        firstWorkerProbe,
        /Temporal worker started\./u,
        'worker alpha'
      )
      assertProbe(
        secondWorkerProbe,
        /Temporal worker started\./u,
        'worker bravo'
      )
    },
    dualStackTimeoutMs
  )
})
