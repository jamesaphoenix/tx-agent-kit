import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getTestkitEnv, getTestkitProcessEnv } from './env.js'

export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const parseTimeoutMs = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

export const repoRoot = resolve(import.meta.dirname, '../../..')
export const txCliPath = resolve(repoRoot, 'scripts/tx-cli.mjs')
export const dbTriggerCliPath = resolve(repoRoot, 'scripts/db/new-trigger.mjs')
export const scaffoldCliPath = resolve(repoRoot, 'packages/tooling/scaffold/src/cli.ts')
export const tsxLoaderPath = resolve(repoRoot, 'node_modules/tsx/dist/loader.mjs')
const defaultCommandTimeoutMs = parseTimeoutMs(
  getTestkitEnv().TESTKIT_COMMAND_TIMEOUT_MS,
  30_000
)

export const createTempRoot = (prefix: string): string => {
  return mkdtempSync(resolve(tmpdir(), prefix))
}

export const writeFixturePackageJson = (root: string): void => {
  writeFileSync(
    resolve(root, 'package.json'),
    `${JSON.stringify({ name: 'tx-agent-kit' }, null, 2)}\n`,
    'utf8'
  )
}

export const createDbTriggerFixture = (root: string): void => {
  writeFixturePackageJson(root)
  mkdirSync(resolve(root, 'packages/infra/db/drizzle/migrations'), { recursive: true })
}

export const createScaffoldFixture = (root: string): void => {
  writeFixturePackageJson(root)
  mkdirSync(resolve(root, 'packages/core/src'), { recursive: true })
  writeFileSync(
    resolve(root, 'packages/core/src/index.ts'),
    "export { CoreError } from './errors.js'\n",
    'utf8'
  )
  mkdirSync(resolve(root, 'apps/api/src'), { recursive: true })
}

export const createScaffoldWithDbFixture = (root: string): void => {
  createScaffoldFixture(root)
  mkdirSync(resolve(root, 'packages/infra/db/src/effect-schemas'), { recursive: true })
  mkdirSync(resolve(root, 'packages/infra/db/src/factories'), { recursive: true })
  mkdirSync(resolve(root, 'packages/infra/db/src/repositories'), { recursive: true })
  writeFileSync(
    resolve(root, 'packages/infra/db/src/schema.ts'),
    [
      "import { relations } from 'drizzle-orm'",
      "import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'",
      '',
      "export const users = pgTable('users', {",
      "  id: uuid('id').defaultRandom().primaryKey(),",
      "  email: text('email').notNull(),",
      "  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()",
      '})',
      '',
      'export const usersRelations = relations(users, ({ many }) => ({',
      '  organizations: many(users)',
      '}))',
      ''
    ].join('\n'),
    'utf8'
  )
  writeFileSync(resolve(root, 'packages/infra/db/src/effect-schemas/index.ts'), '', 'utf8')
  writeFileSync(resolve(root, 'packages/infra/db/src/factories/index.ts'), '', 'utf8')
  writeFileSync(resolve(root, 'packages/infra/db/src/index.ts'), '', 'utf8')
}

export const createDispatcherDbFixture = (root: string): void => {
  writeFixturePackageJson(root)
  mkdirSync(resolve(root, 'packages/infra/db/drizzle/migrations'), { recursive: true })
  mkdirSync(resolve(root, 'scripts/db'), { recursive: true })

  copyFileSync(txCliPath, resolve(root, 'scripts/tx-cli.mjs'))
  copyFileSync(dbTriggerCliPath, resolve(root, 'scripts/db/new-trigger.mjs'))
}

export const runCommand = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = defaultCommandTimeoutMs
): CommandResult => {
  const result = spawnSync(command, args, {
    cwd,
    env: getTestkitProcessEnv(),
    encoding: 'utf8',
    timeout: timeoutMs
  })

  if (result.error) {
    throw result.error
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

export const runScaffoldCli = (cwd: string, args: string[]): CommandResult =>
  runCommand(
    process.execPath,
    ['--import', tsxLoaderPath, scaffoldCliPath, ...args],
    cwd
  )
