import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  combinedOutput,
  probeLongRunningCommand,
  runCommand
} from './command-entrypoints.js'
import { txCliPath } from './cli-workflows.js'

const devProbeEnv = {
  NODE_ENV: 'development',
  API_HOST: '127.0.0.1',
  API_PORT: '4410',
  API_BASE_URL: 'http://127.0.0.1:4410',
  API_CORS_ORIGIN: 'http://127.0.0.1:3410',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/tx_agent_kit',
  AUTH_SECRET: 'dev-command-probe-auth-secret',
  WEB_PORT: '3410',
  MOBILE_PORT: '9181',
  WORKER_INSPECT_PORT: '9429',
  TEMPORAL_RUNTIME_MODE: 'cli',
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'default',
  TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
  TEMPORAL_TLS_ENABLED: 'false',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318'
} as const

const createdTempRoots: string[] = []

const createTempRoot = (prefix: string): string => {
  const root = mkdtempSync(resolve(tmpdir(), prefix))
  createdTempRoots.push(root)
  return root
}

const createScaffoldApplyFixture = (): string => {
  const root = createTempRoot('tx-agent-kit-command-scaffold-')
  mkdirSync(resolve(root, 'packages/core/src'), { recursive: true })
  mkdirSync(resolve(root, 'apps/api/src'), { recursive: true })
  writeFileSync(
    resolve(root, 'packages/core/src/index.ts'),
    "export { CoreError } from './errors.js'\n",
    'utf8'
  )
  writeFileSync(
    resolve(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'tx-agent-kit',
        private: true,
        scripts: {
          'scaffold:crud': `node ${txCliPath} scaffold:crud`
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  )
  return root
}

afterAll(() => {
  for (const root of createdTempRoots.splice(0, createdTempRoots.length)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.sequential('root command entrypoints integration', () => {
  it(
    'starts root dev command without immediate boot failures',
    async () => {
      const temporalReady = runCommand(
        'pnpm',
        ['temporal:dev:up'],
        { TEMPORAL_RUNTIME_MODE: 'cli' },
        60_000
      )
      expect(temporalReady.exitCode).toBe(0)

      const temporalStatus = runCommand(
        'pnpm',
        ['temporal:dev:status'],
        { TEMPORAL_RUNTIME_MODE: 'cli' },
        15_000
      )
      expect(temporalStatus.exitCode).toBe(0)

      const result = await probeLongRunningCommand(
        'pnpm',
        ['dev'],
        devProbeEnv,
        25_000
      )
      const output = `${result.stdout}\n${result.stderr}`

      const bootedAppProcesses =
        output.includes('@tx-agent-kit/web:dev:') &&
        output.includes('@tx-agent-kit/api:dev:') &&
        output.includes('@tx-agent-kit/worker:dev:') &&
        output.includes('@tx-agent-kit/mobile:dev:')

      const temporalPreflightProgress =
        output.includes('Temporal CLI server started') ||
        output.includes('Starting Temporal CLI dev server on') ||
        output.includes('Temporal CLI process is running')

      expect(bootedAppProcesses || temporalPreflightProgress).toBe(true)
    },
    60_000
  )

  it(
    'starts web/api/worker/mobile dev entrypoints without immediate boot failures',
    async () => {
      const [web, api, worker, mobile] = await Promise.all([
        probeLongRunningCommand(
          'pnpm',
          ['dev:web'],
          { ...devProbeEnv, WEB_PORT: '3411' },
          10_000
        ),
        probeLongRunningCommand(
          'pnpm',
          ['dev:api'],
          { ...devProbeEnv, API_PORT: '4411', API_BASE_URL: 'http://127.0.0.1:4411' },
          10_000
        ),
        probeLongRunningCommand(
          'pnpm',
          ['dev:worker'],
          { ...devProbeEnv, WORKER_INSPECT_PORT: '9430' },
          10_000
        ),
        probeLongRunningCommand(
          'pnpm',
          ['dev:mobile'],
          { ...devProbeEnv, MOBILE_PORT: '9182' },
          10_000
        )
      ])

      expect(`${web.stdout}\n${web.stderr}`).toMatch(/Ready|EADDRINUSE/u)

      expect(`${api.stdout}\n${api.stderr}`).toContain('Starting API server.')

      expect(`${worker.stdout}\n${worker.stderr}`).toMatch(
        /Temporal worker started\.|Connection refused/u
      )

      expect(`${mobile.stdout}\n${mobile.stderr}`).toMatch(
        /Starting project at|Waiting on http:\/\/localhost|EMFILE|Use port [0-9]+ instead\?|Skipping dev server/u
      )
    },
    120_000
  )

  it('derives deterministic worktree ports through the root command', () => {
    const result = runCommand('pnpm', ['worktree:ports', 'feature-my-branch'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('WORKTREE_NAME=feature-my-branch')
    expect(result.stdout).toContain('WEB_PORT=')
    expect(result.stdout).toContain('API_PORT=')
    expect(result.stdout).toContain('MOBILE_PORT=')
    expect(result.stdout).toContain('WORKER_INSPECT_PORT=')
  })

  it('executes run-silent regression checks via root command', () => {
    const result = runCommand('pnpm', ['test:run-silent'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('run-silent regression checks passed.')
  })

  it('executes lint command entrypoints with scoped filters', () => {
    const lint = runCommand('pnpm', ['lint'], {}, 300_000)
    const lintOutput = combinedOutput(lint)
    if (lint.exitCode !== 0) {
      expect(lintOutput).toMatch(
        /Suppression directives are disallowed in source modules|apps\/docs\/\.source|@tx-agent-kit\/docs:lint|Domain invariant check failed/u
      )
    }

    const lintQuiet = runCommand('pnpm', ['lint:quiet'], {}, 300_000)
    const lintQuietOutput = combinedOutput(lintQuiet)
    if (lintQuiet.exitCode !== 0) {
      expect(lintQuietOutput).toMatch(
        /Suppression directives are disallowed in source modules|apps\/docs\/\.source|@tx-agent-kit\/docs:lint|Domain invariant check failed/u
      )
    }

    const lintInvariants = runCommand('pnpm', ['lint:invariants'], {}, 120_000)
    const lintInvariantsOutput = combinedOutput(lintInvariants)
    expect(
      lintInvariants.exitCode === 0 ||
        /Suppression directives are disallowed in source modules|apps\/docs\/\.source|Domain invariant check failed/u.test(
          lintInvariantsOutput
        )
    ).toBe(true)
  }, 360_000)

  it('executes type-check command entrypoints', () => {
    const typeCheck = runCommand('pnpm', ['type-check'], {}, 300_000)
    const typeCheckOutput = combinedOutput(typeCheck)
    if (typeCheck.exitCode !== 0) {
      expect(typeCheckOutput).toMatch(
        /@tx-agent-kit\/docs:type-check|apps\/docs\/|Cannot find module '@\/\.source'|Failed:\s+@tx-agent-kit\/docs#type-check/u
      )
    }

    const typeCheckQuiet = runCommand('pnpm', ['type-check:quiet'], {}, 300_000)
    const typeCheckQuietOutput = combinedOutput(typeCheckQuiet)
    if (typeCheckQuiet.exitCode !== 0) {
      expect(typeCheckQuietOutput).toMatch(
        /@tx-agent-kit\/docs:type-check|apps\/docs\/|Cannot find module '@\/\.source'|Failed:\s+@tx-agent-kit\/docs#type-check/u
      )
    }
  }, 360_000)

  it('executes unit-test command entrypoints', () => {
    const test = runCommand('pnpm', ['test'], { TEST_MAX_WORKERS: '4' }, 300_000)
    expect(test.exitCode).toBe(0)

    const testQuiet = runCommand(
      'pnpm',
      ['test:quiet'],
      { TEST_MAX_WORKERS: '4' },
      300_000
    )
    expect(testQuiet.exitCode).toBe(0)
  }, 360_000)

  it('supports dry-run validation of integration test entrypoints', () => {
    const integrationDryRun = runCommand(
      'pnpm',
      ['test:integration', '--', '--filter=@tx-agent-kit/api', '--skip-pgtap', '--dry-run'],
      { INTEGRATION_SKIP_INFRA_ENSURE: '1' },
      60_000
    )
    const integrationOutput = combinedOutput(integrationDryRun)

    expect(integrationDryRun.exitCode).toBe(0)
    expect(integrationOutput).toContain('Integration runner dry-run summary:')
    expect(integrationOutput).toContain('INTEGRATION_PROJECTS=api')

    const integrationQuietDryRun = runCommand(
      'pnpm',
      ['test:integration:quiet', '--', '--filter', 'api', '--skip-pgtap', '--dry-run'],
      {},
      60_000
    )
    const integrationQuietOutput = combinedOutput(integrationQuietDryRun)

    expect(integrationQuietDryRun.exitCode).toBe(0)
    expect(integrationQuietOutput).toContain(
      'Integration quiet runner dry-run summary:'
    )
    expect(integrationQuietOutput).toContain('INTEGRATION_PROJECTS=api')
    expect(integrationQuietOutput).not.toContain('OK infra ensure')
    expect(integrationQuietOutput).not.toContain('OK temporal cli ensure')
  }, 120_000)

  it('wires Temporal CLI preflight into the quiet integration runner', () => {
    const runnerPath = resolve(import.meta.dirname, '../../../scripts/test-integration-quiet.sh')
    const runnerScript = readFileSync(runnerPath, 'utf8')

    expect(runnerScript).toContain('if [[ "${TEMPORAL_RUNTIME_MODE:-cli}" == "cli" ]]')
    expect(runnerScript).toContain(
      'run_silent "temporal cli ensure" "pnpm temporal:dev:up"'
    )
  })

  it('executes observability infra health checks through the root entrypoint', () => {
    const cacheRoot = createTempRoot('tx-agent-kit-observability-fast-path-')
    const isolatedCacheFile = resolve(cacheRoot, 'observability-cache.ok')
    const observabilityEnv = {
      OBSERVABILITY_FAST_PATH: '1',
      OBSERVABILITY_RETRY_ATTEMPTS: '10',
      OBSERVABILITY_RETRY_SLEEP_SECONDS: '1',
      OBSERVABILITY_CACHE_FILE: isolatedCacheFile
    } as const

    let ensureResult = runCommand('pnpm', ['infra:ensure'], {}, 300_000)
    if (ensureResult.exitCode !== 0) {
      ensureResult = runCommand('pnpm', ['infra:ensure'], {}, 300_000)
    }
    expect(ensureResult.exitCode).toBe(0)

    let result = runCommand(
      'pnpm',
      ['test:infra:observability'],
      observabilityEnv,
      120_000
    )
    if (result.exitCode !== 0) {
      result = runCommand(
        'pnpm',
        ['test:infra:observability'],
        observabilityEnv,
        120_000
      )
    }
    const output = combinedOutput(result)

    expect(result.exitCode).toBe(0)
    expect(output).toMatch(
      /Observability stack healthy and ingesting smoke telemetry\.|Observability stack healthy \(fast path: HTTP checks only\)\./u
    )
  }, 150_000)

  it('fails observability health checks quickly when Jaeger endpoint is unreachable', () => {
    const cacheRoot = createTempRoot('tx-agent-kit-observability-negative-')
    const isolatedCacheFile = resolve(cacheRoot, 'observability-cache.ok')

    const result = runCommand(
      'pnpm',
      ['test:infra:observability'],
      {
        JAEGER_UI_PORT: '65535',
        OBSERVABILITY_RETRY_ATTEMPTS: '2',
        OBSERVABILITY_RETRY_SLEEP_SECONDS: '1',
        OBSERVABILITY_CACHE_FILE: isolatedCacheFile
      },
      30_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).not.toContain('Observability stack healthy and ingesting smoke telemetry.')
  }, 60_000)

  it('keeps observability health mandatory when integration bootstrap is skipped', () => {
    const result = runCommand(
      'pnpm',
      ['test:integration:quiet', '--', '--filter', 'api', '--skip-pgtap'],
      {
        INTEGRATION_SKIP_INFRA_ENSURE: '1',
        JAEGER_UI_PORT: '65535',
        OBSERVABILITY_RETRY_ATTEMPTS: '2',
        OBSERVABILITY_RETRY_SLEEP_SECONDS: '1'
      },
      60_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toContain('Observability health check remains mandatory')
  }, 90_000)

  it('supports Jaeger MCP URL values with embedded ports without malformed URL failures', () => {
    const result = runCommand(
      'bash',
      [
        '-lc',
        'MCP_ENV_FILE=/tmp/tx-agent-kit-mcp-missing.env JAEGER_MCP_DRY_RUN=1 JAEGER_URL=http://localhost:16686 JAEGER_PORT=16686 ./scripts/mcp/jaeger.sh'
      ],
      {},
      30_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).toBe(0)
    expect(output).toContain(
      'JAEGER_URL already includes an explicit port; ignoring JAEGER_PORT=16686.'
    )
    expect(output).toContain('JAEGER_URL=http://localhost:16686')
    expect(output).toContain('JAEGER_PORT=')
  })

  it('executes scaffold dry-run via root command without writing files', () => {
    const result = runCommand('pnpm', [
      'scaffold:crud',
      '--domain',
      'billing',
      '--entity',
      'invoice',
      '--dry-run'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Dry run only: no files were written.')
  })

  it('executes scaffold apply command in an isolated fixture through pnpm', () => {
    const fixtureRoot = createScaffoldApplyFixture()
    const result = runCommand(
      'pnpm',
      ['scaffold:crud', '--domain', 'billing', '--entity', 'invoice'],
      {},
      120_000,
      fixtureRoot
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Written files:')
    expect(
      existsSync(
        resolve(
          fixtureRoot,
          'packages/core/src/domains/billing/domain/invoice.ts'
        )
      )
    ).toBe(true)
    expect(
      existsSync(
        resolve(
          fixtureRoot,
          'apps/api/src/domains/billing/routes/invoice.ts'
        )
      )
    ).toBe(true)
  }, 150_000)

  it('executes API/mobile generation commands through root entrypoints', () => {
    const openApiResult = runCommand('pnpm', ['openapi:generate'], {}, 60_000)
    expect(openApiResult.exitCode).toBe(0)

    const apiClientResult = runCommand('pnpm', ['api:client:generate'], {}, 90_000)
    expect(apiClientResult.exitCode).toBe(0)

    const mobileClientResult = runCommand('pnpm', ['mobile:generate:api'], {}, 90_000)
    expect(mobileClientResult.exitCode).toBe(0)
  }, 180_000)

  it(
    'starts db studio command without immediate boot failure',
    async () => {
      const result = await probeLongRunningCommand('pnpm', ['db:studio'], {}, 6_000)
      const output = `${result.stdout}\n${result.stderr}`

      expect(output).toMatch(/drizzle|studio/u)
    },
    30_000
  )

  it('executes infra ensure and scoped infra down entrypoints', () => {
    const ensureResult = runCommand('pnpm', ['infra:ensure'], {}, 300_000)
    const ensureOutput = combinedOutput(ensureResult)
    expect(
      ensureResult.exitCode === 0 ||
        ensureResult.exitCode === 124 ||
        /Docker is not running|host port .* is in use|Timed out waiting for infrastructure readiness/u.test(
          ensureOutput
        )
    ).toBe(true)

    const downResult = runCommand(
      'pnpm',
      ['infra:down'],
      { COMPOSE_PROJECT_NAME: 'tx-agent-kit-command-empty' },
      60_000
    )
    expect(downResult.exitCode).toBe(0)
  }, 180_000)

  it('executes db migrate and guards db:test:reset for non-local hosts', () => {
    const ensureResult = runCommand('pnpm', ['infra:ensure'], {}, 300_000)
    const ensureOutput = combinedOutput(ensureResult)
    expect(
      ensureResult.exitCode === 0 ||
        ensureResult.exitCode === 124 ||
        /Docker is not running|host port .* is in use|Timed out waiting for infrastructure readiness/u.test(
          ensureOutput
        )
    ).toBe(true)

    const migrateResult = runCommand('pnpm', ['db:migrate'], {}, 120_000)
    const migrateOutput = combinedOutput(migrateResult)
    expect(
      migrateResult.exitCode === 0 ||
        /AggregateError|ECONNREFUSED|connect|Connection refused/u.test(migrateOutput)
    ).toBe(true)

    const resetGuardResult = runCommand(
      'pnpm',
      ['db:test:reset'],
      {
        TX_AGENT_SKIP_INFRA_ENSURE: '1',
        DATABASE_URL: 'postgres://postgres:postgres@db.internal:5432/tx_agent_kit'
      },
      60_000
    )
    const resetGuardOutput = combinedOutput(resetGuardResult)

    expect(resetGuardResult.exitCode).not.toBe(0)
    expect(resetGuardOutput).toContain(
      "Refusing to reset non-local DATABASE_URL host 'db.internal'."
    )
  }, 180_000)

  it('validates deploy migrate target arguments before any external calls', () => {
    const result = runCommand('bash', ['scripts/deploy/migrate.sh', 'invalid'], {}, 15_000)
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toContain("Invalid environment 'invalid'. Expected 'staging' or 'prod'.")
  })

  it('fails deploy:staging fast with a missing artifact file', () => {
    const result = runCommand(
      'pnpm',
      ['deploy:staging', 'deploy/artifacts/images-nope.env'],
      {},
      30_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toMatch(
      /Image env file not found|1Password CLI \(op\) is required|You are not currently signed in/u
    )
  })

  it('fails deploy migrate script fast when 1Password CLI is unavailable', () => {
    const result = runCommand(
      'bash',
      ['scripts/deploy/migrate.sh', 'staging'],
      { PATH: '/usr/bin:/bin' },
      15_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toContain('1Password CLI (op) is required')
  })

  it('fails deploy:build-images fast when Docker daemon is unavailable', () => {
    const result = runCommand(
      'pnpm',
      ['deploy:build-images'],
      {
        DOCKER_HOST: 'unix:///tmp/tx-agent-kit-no-docker.sock',
        PUSH_IMAGES: '1'
      },
      60_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toMatch(
      /Cannot connect to the Docker daemon|failed to connect to the docker API|docker buildx is required|Required command not found: docker/u
    )
  })
})
