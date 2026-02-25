import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyCrudScaffold,
  inspectFile,
  parseCrudArgs,
  planCrudScaffold,
  scaffoldSummary
} from './index.js'

const tempRoots: string[] = []

const createFixtureRepo = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'tx-agent-kit-scaffold-'))
  tempRoots.push(root)

  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await writeFile(
    join(root, 'packages/core/src/index.ts'),
    "export { CoreError } from './errors.js'\n",
    'utf8'
  )

  await mkdir(join(root, 'apps/api/src'), { recursive: true })

  return root
}

afterEach(async () => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('crud scaffold planner', () => {
  it('plans core + api layer files for a CRUD scaffold', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'invoice' })
    expect(planned.length).toBe(24)
    expect(planned.some((file) => file.path.includes('packages/core/src/domains/billing/domain/invoice.ts'))).toBe(true)
    expect(planned.some((file) => file.path.includes('apps/api/src/domains/billing/routes/invoice.ts'))).toBe(true)
  })

  it('supports custom plural names', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'category', plural: 'catalog-categories' })
    expect(planned.some((file) => file.content.includes("CatalogCategoriesCollectionName = 'catalog-categories'"))).toBe(
      true
    )
    expect(planned.some((file) => file.content.includes("CategoryRoutesPath = '/catalog-categories'"))).toBe(true)
  })

  it('infers default plural with y -> ies rule', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'category' })
    expect(planned.some((file) => file.content.includes("CategoriesCollectionName = 'categories'"))).toBe(true)
    expect(planned.some((file) => file.content.includes("CategoryRoutesPath = '/categories'"))).toBe(true)
  })

  it('normalizes mixed-case and underscore input names', () => {
    const planned = planCrudScaffold({ domain: 'User_Management', entity: 'TeamMember' })
    expect(planned.some((file) => file.path.includes('packages/core/src/domains/user-management/domain/team-member.ts'))).toBe(
      true
    )
    expect(planned.some((file) => file.content.includes('export const TeamMemberIdSchema'))).toBe(true)
  })

  it('includes layered barrel exports for domain roots', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'invoice' })
    const coreDomainRootIndex = planned.find((file) => file.path.endsWith('packages/core/src/domains/billing/index.ts'))
    const apiDomainRootIndex = planned.find((file) => file.path.endsWith('apps/api/src/domains/billing/index.ts'))

    expect(coreDomainRootIndex?.content).toContain("export * from './domain/index.js'")
    expect(coreDomainRootIndex?.content).toContain("export * from './application/index.js'")
    expect(coreDomainRootIndex?.content).toContain("export * from './adapters/index.js'")
    expect(apiDomainRootIndex?.content).toContain("export * from './routes/index.js'")
  })

  it('plans db artifacts when withDb is enabled', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'invoice' }, { withDb: true })
    expect(planned.length).toBe(27)
    expect(planned.some((file) => file.path === 'packages/infra/db/src/effect-schemas/billing-invoices.ts')).toBe(true)
    expect(planned.some((file) => file.path === 'packages/infra/db/src/factories/billing-invoices.factory.ts')).toBe(true)
    expect(planned.some((file) => file.path === 'packages/infra/db/src/repositories/billing-invoices.ts')).toBe(true)

    const effectSchemaFile = planned.find((file) => file.path === 'packages/infra/db/src/effect-schemas/billing-invoices.ts')
    const factoryFile = planned.find((file) => file.path === 'packages/infra/db/src/factories/billing-invoices.factory.ts')
    const repositoryFile = planned.find((file) => file.path === 'packages/infra/db/src/repositories/billing-invoices.ts')

    expect(effectSchemaFile?.content).toContain('updatedAt: Schema.DateFromSelf')
    expect(factoryFile?.content).toContain('updatedAt?: Date')
    expect(factoryFile?.content).toContain('updatedAt: options.updatedAt ?? createdAt')
    expect(repositoryFile?.content).toContain('getById: (id: string)')
    expect(repositoryFile?.content).toContain('update: (input: { id: string; name?: string })')
    expect(repositoryFile?.content).toContain('remove: (id: string)')
    expect(repositoryFile?.content).toContain('.execute()')
  })

  it('includes effect schema in generated domain files', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'invoice' })
    const domainFile = planned.find((file) => file.path.endsWith('/domain/invoice.ts'))
    expect(domainFile?.content).toContain("import * as Schema from 'effect/Schema'")
    expect(domainFile?.content).toContain('CreateInvoiceInputSchema')
    expect(domainFile?.content).toContain('UpdateInvoiceInputSchema')
  })

  it('includes CRUD methods across store port, service, and routes', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'invoice' })
    const joined = planned.map((file) => file.content).join('\n')

    expect(joined).toContain("InvoiceRepositoryKind = 'crud'")
    expect(joined).toContain("InvoiceRouteKind = 'crud'")
    expect(joined).toContain('list: () =>')
    expect(joined).toContain('getById: (id')
    expect(joined).toContain('create: (input')
    expect(joined).toContain('update: (input')
    expect(joined).toContain('remove: (id')
  })

  it('brands generated store IDs by casting the full id expression', () => {
    const planned = planCrudScaffold({ domain: 'billing', entity: 'invoice' })
    const storeAdapterFile = planned.find((file) =>
      file.path.endsWith('/adapters/invoice-store-adapter.ts')
    )
    expect(storeAdapterFile?.content).toContain(
      "const idFactory = options.idFactory ?? (() => ('invoice-' + String(nextId++)) as InvoiceId)"
    )
  })

  it('throws on invalid domain names', () => {
    expect(() => planCrudScaffold({ domain: 'billing/payments', entity: 'invoice' })).toThrow('Invalid domain')
  })

  it('throws on invalid entity names', () => {
    expect(() => planCrudScaffold({ domain: 'billing', entity: 'invoice$' })).toThrow('Invalid entity')
  })
})

describe('crud scaffold apply', () => {
  it('writes planned files and updates core barrel export', async () => {
    const repoRoot = await createFixtureRepo()
    const result = await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })

    expect(result.written.length).toBe(24)
    expect(result.updatedBarrels).toEqual(['packages/core/src/index.ts'])

    const coreIndex = await readFile(join(repoRoot, 'packages/core/src/index.ts'), 'utf8')
    expect(coreIndex).toContain("export * from './domains/billing/index.js'")
  })

  it('writes db files and updates db wiring when withDb is enabled', async () => {
    const repoRoot = await createFixtureRepo()
    await mkdir(join(repoRoot, 'packages/infra/db/src/effect-schemas'), { recursive: true })
    await mkdir(join(repoRoot, 'packages/infra/db/src/factories'), { recursive: true })
    await mkdir(join(repoRoot, 'packages/infra/db/src/repositories'), { recursive: true })
    await writeFile(
      join(repoRoot, 'packages/infra/db/src/schema.ts'),
      "import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'\n\nexport const users = pgTable('users', {\n  id: uuid('id').defaultRandom().primaryKey(),\n  email: text('email').notNull(),\n  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()\n})\n\nexport const usersRelations = relations(users, ({ many }) => ({\n  organizations: many(users)\n}))\n",
      'utf8'
    )
    await writeFile(join(repoRoot, 'packages/infra/db/src/effect-schemas/index.ts'), '', 'utf8')
    await writeFile(join(repoRoot, 'packages/infra/db/src/factories/index.ts'), '', 'utf8')
    await writeFile(join(repoRoot, 'packages/infra/db/src/index.ts'), '', 'utf8')

    const result = await applyCrudScaffold({
      repoRoot,
      domain: 'billing',
      entity: 'invoice',
      withDb: true
    })

    expect(result.written.length).toBe(27)
    expect(result.updatedBarrels).toContain('packages/infra/db/src/schema.ts')
    expect(result.updatedBarrels).toContain('packages/infra/db/src/effect-schemas/index.ts')
    expect(result.updatedBarrels).toContain('packages/infra/db/src/factories/index.ts')
    expect(result.updatedBarrels).toContain('packages/infra/db/src/index.ts')

    const schemaFile = await readFile(join(repoRoot, 'packages/infra/db/src/schema.ts'), 'utf8')
    expect(schemaFile).toContain("export const billingInvoices = pgTable('billing_invoices'")
    expect(schemaFile).toContain("updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()")

    const dbIndexFile = await readFile(join(repoRoot, 'packages/infra/db/src/index.ts'), 'utf8')
    expect(dbIndexFile).toContain("export { invoiceDbRepository } from './repositories/billing-invoices.js'")
  })

  it('is idempotent without force and reports skipped files', async () => {
    const repoRoot = await createFixtureRepo()
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })
    const second = await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })

    expect(second.written.length).toBe(0)
    expect(second.skipped.length).toBe(24)
  })

  it('overwrites files when force is enabled', async () => {
    const repoRoot = await createFixtureRepo()
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })

    const targetPath = join(repoRoot, 'packages/core/src/domains/billing/application/invoice-service.ts')
    await writeFile(targetPath, 'BROKEN_FILE\n', 'utf8')

    const forced = await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice', force: true })
    expect(forced.written.length).toBeGreaterThan(0)
    expect(forced.written).toContain('packages/core/src/domains/billing/application/invoice-service.ts')

    const rewritten = await readFile(targetPath, 'utf8')
    expect(rewritten).toContain('makeInvoiceService')
    expect(rewritten).not.toContain('BROKEN_FILE')
  })

  it('supports dry run mode with no writes', async () => {
    const repoRoot = await createFixtureRepo()
    const dryRun = await applyCrudScaffold({
      repoRoot,
      domain: 'billing',
      entity: 'invoice',
      dryRun: true
    })

    expect(dryRun.written).toHaveLength(0)
    expect(dryRun.planned).toHaveLength(24)

    const expectedFile = join(repoRoot, 'packages/core/src/domains/billing/application/invoice-service.ts')
    expect(existsSync(expectedFile)).toBe(false)
  })

  it('can scaffold when core barrel is missing without failing', async () => {
    const repoRoot = await createFixtureRepo()
    await rm(join(repoRoot, 'packages/core/src/index.ts'))

    const result = await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })
    expect(result.written.length).toBe(24)
    expect(result.updatedBarrels).toHaveLength(0)
  })

  it('does not duplicate barrel exports on repeated runs', async () => {
    const repoRoot = await createFixtureRepo()

    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice', force: true })

    const coreIndex = await readFile(join(repoRoot, 'packages/core/src/index.ts'), 'utf8')
    const matches = coreIndex.match(/domains\/billing\/index\.js/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('merges layer index exports when adding a second entity to the same domain', async () => {
    const repoRoot = await createFixtureRepo()

    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'payment' })

    const coreDomainIndex = await readFile(join(repoRoot, 'packages/core/src/domains/billing/domain/index.ts'), 'utf8')
    const corePortsIndex = await readFile(join(repoRoot, 'packages/core/src/domains/billing/ports/index.ts'), 'utf8')
    const apiRoutesIndex = await readFile(join(repoRoot, 'apps/api/src/domains/billing/routes/index.ts'), 'utf8')

    expect(coreDomainIndex).toContain("export * from './invoice.js'")
    expect(coreDomainIndex).toContain("export * from './payment.js'")
    expect(corePortsIndex).toContain("export * from './invoice-store-port.js'")
    expect(corePortsIndex).toContain("export * from './payment-store-port.js'")
    expect(apiRoutesIndex).toContain("export * from './invoice.js'")
    expect(apiRoutesIndex).toContain("export * from './payment.js'")
  })

  it('creates tests for core service and api routes', async () => {
    const repoRoot = await createFixtureRepo()
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })

    const coreTestPath = join(repoRoot, 'packages/core/src/domains/billing/application/invoice-service.test.ts')
    const apiTestPath = join(repoRoot, 'apps/api/src/domains/billing/routes/invoice.test.ts')

    expect(existsSync(coreTestPath)).toBe(true)
    expect(existsSync(apiTestPath)).toBe(true)

    const coreTest = await readFile(coreTestPath, 'utf8')
    expect(coreTest).toContain('create -> list -> getById -> update -> remove')

    const apiTest = await readFile(apiTestPath, 'utf8')
    expect(apiTest).toContain('delegates CRUD calls to the service layer')
  })

  it('writes required domain folders in api scaffold for invariant compliance', async () => {
    const repoRoot = await createFixtureRepo()
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })

    const requiredPaths = [
      'apps/api/src/domains/billing/domain/index.ts',
      'apps/api/src/domains/billing/ports/index.ts',
      'apps/api/src/domains/billing/application/index.ts',
      'apps/api/src/domains/billing/adapters/index.ts'
    ]

    for (const relativePath of requiredPaths) {
      expect(existsSync(join(repoRoot, relativePath))).toBe(true)
    }
  })

  it('produces human-readable scaffold summary', async () => {
    const repoRoot = await createFixtureRepo()
    const summary = await scaffoldSummary({ repoRoot, domain: 'billing', entity: 'invoice' })

    expect(summary).toContain('Planned files: 24')
    expect(summary).toContain('Written files: 24')
    expect(summary).toContain('Updated barrels: 1')
  })

  it('produces dry-run scaffold summary without writing files', async () => {
    const repoRoot = await createFixtureRepo()
    const summary = await scaffoldSummary({
      repoRoot,
      domain: 'billing',
      entity: 'invoice',
      dryRun: true
    })

    expect(summary).toContain('Planned files: 24')
    expect(summary).toContain('Written files: 0')
    expect(summary).toContain('Dry run only: no files were written.')
  })

  it('inspectFile returns metadata for generated files', async () => {
    const repoRoot = await createFixtureRepo()
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })

    const metadata = await inspectFile(join(repoRoot, 'packages/core/src/domains/billing/domain/invoice.ts'))
    expect(metadata.exists).toBe(true)
    expect(metadata.size).toBeGreaterThan(100)
  })

  it('inspectFile returns empty metadata for missing files', async () => {
    const repoRoot = await createFixtureRepo()
    const metadata = await inspectFile(join(repoRoot, 'packages/core/src/domains/billing/domain/missing.ts'))
    expect(metadata).toEqual({ exists: false, size: 0 })
  })

  it('scaffolds routes with stable path constants', async () => {
    const repoRoot = await createFixtureRepo()
    await applyCrudScaffold({ repoRoot, domain: 'billing', entity: 'invoice' })

    const routeFile = await readFile(join(repoRoot, 'apps/api/src/domains/billing/routes/invoice.ts'), 'utf8')
    expect(routeFile).toContain("export const InvoiceRoutesPath = '/invoices' as const")
  })
})

describe('crud scaffold args parser', () => {
  it('parses required args with optional flags', () => {
    const parsed = parseCrudArgs([
      '--domain',
      'billing',
      '--entity',
      'invoice',
      '--plural',
      'invoices',
      '--dry-run',
      '--force',
      '--with-db'
    ])

    expect(parsed).toEqual({
      domain: 'billing',
      entity: 'invoice',
      plural: 'invoices',
      dryRun: true,
      force: true,
      withDb: true
    })
  })

  it('throws for missing required args', () => {
    expect(() => parseCrudArgs(['--domain', 'billing'])).toThrow('Usage: --domain <name> --entity <name>')
  })

  it('defaults dryRun/force to false', () => {
    const parsed = parseCrudArgs(['--domain', 'billing', '--entity', 'invoice'])
    expect(parsed.dryRun).toBe(false)
    expect(parsed.force).toBe(false)
    expect(parsed.withDb).toBe(false)
  })

  it('throws when unknown flags are provided', () => {
    expect(() => parseCrudArgs(['--domain', 'billing', '--entity', 'invoice', '--unknown-flag'])).toThrow(
      'Unknown option: --unknown-flag'
    )
  })

  it('throws when a value flag is missing its value', () => {
    expect(() => parseCrudArgs(['--domain', 'billing', '--entity'])).toThrow('Missing value for --entity')
  })

  it('throws when options are duplicated', () => {
    expect(() => parseCrudArgs(['--domain', 'billing', '--domain', 'ops', '--entity', 'invoice'])).toThrow(
      'Duplicate option: --domain'
    )
  })

  it('supports inline value flags', () => {
    const parsed = parseCrudArgs(['--domain=billing', '--entity=invoice', '--plural=invoices', '--with-db'])
    expect(parsed).toEqual({
      domain: 'billing',
      entity: 'invoice',
      plural: 'invoices',
      dryRun: false,
      force: false,
      withDb: true
    })
  })

  it('supports inline boolean flags', () => {
    const parsed = parseCrudArgs([
      '--domain=billing',
      '--entity=invoice',
      '--with-db=true',
      '--dry-run=false',
      '--force=true'
    ])

    expect(parsed).toEqual({
      domain: 'billing',
      entity: 'invoice',
      plural: undefined,
      dryRun: false,
      force: true,
      withDb: true
    })
  })

  it('throws for invalid inline boolean values', () => {
    expect(() =>
      parseCrudArgs(['--domain=billing', '--entity=invoice', '--with-db=yes'])
    ).toThrow('Invalid boolean value for --with-db')
  })
})
