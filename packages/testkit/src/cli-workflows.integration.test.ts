import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createDispatcherDbFixture as setupDispatcherDbFixture,
  createDbTriggerFixture as setupDbTriggerFixture,
  createScaffoldFixture as setupScaffoldFixture,
  createScaffoldWithDbFixture as setupScaffoldWithDbFixture,
  createTempRoot,
  dbTriggerCliPath,
  repoRoot,
  runCommand,
  runScaffoldCli,
  txCliPath
} from './cli-workflows.js'

const createdTempRoots: string[] = []

const createDbTriggerFixture = (): string => {
  const root = createTempRoot('tx-agent-kit-cli-db-trigger-')
  setupDbTriggerFixture(root)
  createdTempRoots.push(root)
  return root
}

const createScaffoldFixture = (): string => {
  const root = createTempRoot('tx-agent-kit-cli-scaffold-')
  setupScaffoldFixture(root)
  createdTempRoots.push(root)
  return root
}

const createScaffoldWithDbFixture = (): string => {
  const root = createTempRoot('tx-agent-kit-cli-scaffold-db-')
  setupScaffoldWithDbFixture(root)
  createdTempRoots.push(root)
  return root
}

const createDispatcherDbFixture = (): string => {
  const root = createTempRoot('tx-agent-kit-cli-dispatch-db-')
  setupDispatcherDbFixture(root)
  createdTempRoots.push(root)
  return root
}

afterAll(() => {
  for (const root of createdTempRoots.splice(0, createdTempRoots.length)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.sequential('CLI workflows integration', () => {
  it('scaffolds db trigger migration + pgTAP files and rejects duplicate reruns', () => {
    const fixtureRoot = createDbTriggerFixture()

    const firstRun = runCommand(
      process.execPath,
      [
        dbTriggerCliPath,
        '--name',
        'workspace-billing-rollup',
        '--table',
        'tasks',
        '--events',
        'INSERT,UPDATE,DELETE'
      ],
      fixtureRoot
    )

    expect(firstRun.exitCode).toBe(0)
    expect(firstRun.stdout).toContain('Created migration:')
    expect(firstRun.stdout).toContain('Created pgTAP suite:')

    const migrationDir = resolve(fixtureRoot, 'packages/infra/db/drizzle/migrations')
    const pgtapDir = resolve(fixtureRoot, 'packages/infra/db/pgtap')
    const migrationFiles = readdirSync(migrationDir)
    const pgtapFiles = readdirSync(pgtapDir)

    expect(migrationFiles).toEqual(['0001_workspace_billing_rollup.sql'])
    expect(pgtapFiles).toEqual(['001_workspace_billing_rollup.pgtap.sql'])

    const migrationSql = readFileSync(
      resolve(migrationDir, migrationFiles[0]!),
      'utf8'
    )
    const pgtapSql = readFileSync(resolve(pgtapDir, pgtapFiles[0]!), 'utf8')

    expect(migrationSql).toContain('CREATE TRIGGER trg_workspace_billing_rollup')
    expect(migrationSql).toContain('EXECUTE FUNCTION workspace_billing_rollup_fn();')
    expect(migrationSql).toContain("IF TG_OP = 'DELETE' THEN")
    expect(migrationSql).toContain('RETURN NEW;')
    expect(pgtapSql).toContain('trg_workspace_billing_rollup')

    const secondRun = runCommand(
      process.execPath,
      [
        dbTriggerCliPath,
        '--name',
        'workspace-billing-rollup',
        '--table',
        'tasks',
        '--events',
        'INSERT,UPDATE,DELETE'
      ],
      fixtureRoot
    )

    expect(secondRun.exitCode).toBe(1)
    expect(secondRun.stderr).toContain('Migration for trigger already exists')
  })

  it('generates statement-level trigger scaffold for TRUNCATE events', () => {
    const fixtureRoot = createDbTriggerFixture()

    const result = runCommand(
      process.execPath,
      [
        dbTriggerCliPath,
        '--name',
        'workspace-task-truncate-audit',
        '--table',
        'tasks',
        '--events',
        'TRUNCATE',
        '--level',
        'STATEMENT',
        '--timing',
        'AFTER'
      ],
      fixtureRoot
    )

    expect(result.exitCode).toBe(0)

    const migrationDir = resolve(fixtureRoot, 'packages/infra/db/drizzle/migrations')
    const migrationFiles = readdirSync(migrationDir)
    expect(migrationFiles).toEqual(['0001_workspace_task_truncate_audit.sql'])

    const migrationSql = readFileSync(resolve(migrationDir, migrationFiles[0]!), 'utf8')
    expect(migrationSql).toContain('AFTER TRUNCATE ON tasks')
    expect(migrationSql).toContain('FOR EACH STATEMENT')
    expect(migrationSql).toContain('RETURN NULL;')
  })

  it('enforces strict db trigger argument validation', () => {
    const fixtureRoot = createDbTriggerFixture()

    const invalidTruncate = runCommand(
      process.execPath,
      [
        dbTriggerCliPath,
        '--name',
        'truncate-row-trigger',
        '--table',
        'tasks',
        '--events',
        'TRUNCATE',
        '--level',
        'ROW'
      ],
      fixtureRoot
    )

    expect(invalidTruncate.exitCode).toBe(1)
    expect(invalidTruncate.stderr).toContain('TRUNCATE triggers must use --level STATEMENT')
    expect(invalidTruncate.stderr).toContain('Usage:')

    const duplicateName = runCommand(
      process.execPath,
      [
        dbTriggerCliPath,
        '--name',
        'first-name',
        '--name',
        'second-name',
        '--table',
        'tasks'
      ],
      fixtureRoot
    )

    expect(duplicateName.exitCode).toBe(1)
    expect(duplicateName.stderr).toContain('Duplicate option: --name')

    const oversizedTableIdentifier = `${'a'.repeat(64)}`
    const oversizedTable = runCommand(
      process.execPath,
      [
        dbTriggerCliPath,
        '--name',
        'oversized-table-trigger',
        '--table',
        oversizedTableIdentifier
      ],
      fixtureRoot
    )

    expect(oversizedTable.exitCode).toBe(1)
    expect(oversizedTable.stderr).toContain(
      'table name exceeds PostgreSQL identifier length limit (63)'
    )

    const helpShortCircuit = runCommand(
      process.execPath,
      [dbTriggerCliPath, '--help', '--unknown-flag'],
      fixtureRoot
    )

    expect(helpShortCircuit.exitCode).toBe(0)
    expect(helpShortCircuit.stdout).toContain('Usage:')
  })

  it('supports scaffold dry-run/apply/idempotent/force cycles without mocks', () => {
    const fixtureRoot = createScaffoldFixture()
    const scaffoldArgs = ['--domain', 'cli-workflows', '--entity', 'task-bucket']

    const dryRun = runScaffoldCli(fixtureRoot, [...scaffoldArgs, '--dry-run'])
    expect(dryRun.exitCode).toBe(0)
    expect(dryRun.stdout).toContain('Planned files: 24')
    expect(dryRun.stdout).toContain('Written files: 0')
    expect(existsSync(resolve(fixtureRoot, 'packages/core/src/domains/cli-workflows'))).toBe(
      false
    )

    const apply = runScaffoldCli(fixtureRoot, scaffoldArgs)
    expect(apply.exitCode).toBe(0)
    expect(apply.stdout).toContain('Written files: 24')
    expect(apply.stdout).toContain('Skipped files: 0')

    const coreDomainFile = resolve(
      fixtureRoot,
      'packages/core/src/domains/cli-workflows/domain/task-bucket.ts'
    )
    const apiRouteFile = resolve(
      fixtureRoot,
      'apps/api/src/domains/cli-workflows/routes/task-bucket.ts'
    )

    expect(existsSync(coreDomainFile)).toBe(true)
    expect(existsSync(apiRouteFile)).toBe(true)
    expect(readFileSync(coreDomainFile, 'utf8')).toContain('Schema.Struct')
    expect(readFileSync(resolve(fixtureRoot, 'packages/core/src/index.ts'), 'utf8')).toContain(
      "export * from './domains/cli-workflows/index.js'"
    )

    const secondRun = runScaffoldCli(fixtureRoot, scaffoldArgs)
    expect(secondRun.exitCode).toBe(0)
    expect(secondRun.stdout).toContain('Written files: 0')
    expect(secondRun.stdout).toContain('Skipped files: 24')

    const forcedRun = runScaffoldCli(fixtureRoot, [...scaffoldArgs, '--force'])
    expect(forcedRun.exitCode).toBe(0)
    expect(forcedRun.stdout).toContain('Written files: 12')
    expect(forcedRun.stdout).toContain('Skipped files: 12')
  })

  it('enforces strict scaffold argument validation', () => {
    const fixtureRoot = createScaffoldFixture()

    const missingRequired = runScaffoldCli(fixtureRoot, ['--domain', 'cli-workflows'])
    expect(missingRequired.exitCode).toBe(1)
    expect(missingRequired.stderr).toContain('Missing required options: --domain and --entity')
    expect(missingRequired.stderr).toContain('Usage: --domain <name> --entity <name>')

    const duplicateDomain = runScaffoldCli(fixtureRoot, [
      '--domain',
      'cli-workflows',
      '--domain',
      'duplicate',
      '--entity',
      'task-bucket'
    ])
    expect(duplicateDomain.exitCode).toBe(1)
    expect(duplicateDomain.stderr).toContain('Duplicate option: --domain')
  })

  it('scaffolds with --with-db and wires db indexes without mocks', () => {
    const fixtureRoot = createScaffoldWithDbFixture()
    const scaffoldArgs = ['--domain', 'billing', '--entity', 'invoice', '--with-db']

    const apply = runScaffoldCli(fixtureRoot, scaffoldArgs)
    expect(apply.exitCode).toBe(0)
    expect(apply.stdout).toContain('Written files: 27')

    const effectSchemaFile = resolve(
      fixtureRoot,
      'packages/infra/db/src/effect-schemas/billing-invoices.ts'
    )
    const factoryFile = resolve(
      fixtureRoot,
      'packages/infra/db/src/factories/billing-invoices.factory.ts'
    )
    const repositoryFile = resolve(
      fixtureRoot,
      'packages/infra/db/src/repositories/billing-invoices.ts'
    )

    expect(existsSync(effectSchemaFile)).toBe(true)
    expect(existsSync(factoryFile)).toBe(true)
    expect(existsSync(repositoryFile)).toBe(true)

    expect(readFileSync(resolve(fixtureRoot, 'packages/infra/db/src/schema.ts'), 'utf8')).toContain(
      "export const billingInvoices = pgTable('billing_invoices'"
    )
    expect(
      readFileSync(resolve(fixtureRoot, 'packages/infra/db/src/effect-schemas/index.ts'), 'utf8')
    ).toContain("export * from './billing-invoices.js'")
    expect(readFileSync(resolve(fixtureRoot, 'packages/infra/db/src/factories/index.ts'), 'utf8')).toContain(
      "export * from './billing-invoices.factory.js'"
    )
    expect(readFileSync(resolve(fixtureRoot, 'packages/infra/db/src/index.ts'), 'utf8')).toContain(
      "export { invoiceDbRepository } from './repositories/billing-invoices.js'"
    )

    const secondRun = runScaffoldCli(fixtureRoot, scaffoldArgs)
    expect(secondRun.exitCode).toBe(0)
    expect(secondRun.stdout).toContain('Written files: 0')
  })

  it('routes both commands through the shared tx-style dispatcher', () => {
    const scaffoldHelpWithSeparator = runCommand(
      process.execPath,
      [txCliPath, '--', 'scaffold:crud', '--help'],
      repoRoot
    )

    expect(scaffoldHelpWithSeparator.exitCode).toBe(0)
    expect(scaffoldHelpWithSeparator.stdout).toContain('Usage: --domain <name> --entity <name>')

    const scaffoldViaDispatcher = runCommand(
      process.execPath,
      [
        txCliPath,
        'scaffold',
        'crud',
        '--domain',
        'dispatcher-domain',
        '--entity',
        'dispatcher-entity',
        '--dry-run'
      ],
      repoRoot
    )

    expect(scaffoldViaDispatcher.exitCode).toBe(0)
    expect(scaffoldViaDispatcher.stdout).toContain('Dry run only: no files were written.')

    const dbViaDispatcher = runCommand(
      process.execPath,
      [
        txCliPath,
        'db',
        'trigger',
        'new',
        '--name',
        'dispatcher-trigger',
        '--table',
        'tasks',
        '--events',
        'TRUNCATE',
        '--level',
        'ROW'
      ],
      repoRoot
    )

    expect(dbViaDispatcher.exitCode).toBe(1)
    expect(dbViaDispatcher.stderr).toContain('TRUNCATE triggers must use --level STATEMENT')
  })

  it('routes db trigger success through dispatcher in an isolated fixture repo', () => {
    const fixtureRoot = createDispatcherDbFixture()
    const fixtureTxCliPath = resolve(fixtureRoot, 'scripts/tx-cli.mjs')

    const result = runCommand(
      process.execPath,
      [
        fixtureTxCliPath,
        'db',
        'trigger',
        'new',
        '--name',
        'dispatcher-db-success',
        '--table',
        'tasks',
        '--events',
        'INSERT,UPDATE'
      ],
      fixtureRoot
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Created migration:')
    expect(result.stdout).toContain('Created pgTAP suite:')

    const migrationFiles = readdirSync(resolve(fixtureRoot, 'packages/infra/db/drizzle/migrations'))
    const pgtapFiles = readdirSync(resolve(fixtureRoot, 'packages/infra/db/pgtap'))
    expect(migrationFiles).toEqual(['0001_dispatcher_db_success.sql'])
    expect(pgtapFiles).toEqual(['001_dispatcher_db_success.pgtap.sql'])
  })
})
