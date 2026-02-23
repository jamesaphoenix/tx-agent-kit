import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CrudScaffoldInput {
  domain: string
  entity: string
  plural?: string
}

export interface CrudScaffoldOptions extends CrudScaffoldInput {
  repoRoot: string
  dryRun?: boolean
  force?: boolean
  withDb?: boolean
}

export interface PlannedFile {
  path: string
  content: string
}

export interface ApplyScaffoldResult {
  written: string[]
  skipped: string[]
  updatedBarrels: string[]
  planned: string[]
}

interface NameSet {
  domainSlug: string
  entitySlug: string
  pluralSlug: string
  Domain: string
  Entity: string
  Entities: string
  entity: string
}

const ensureValidName = (value: string, label: string): void => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: '${value}'. Use only letters, numbers, hyphen, and underscore.`)
  }
}

const toKebabCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()

const toPascalCase = (value: string): string =>
  toKebabCase(value)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

const toCamelCase = (value: string): string => {
  const pascal = toPascalCase(value)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

const inferPlural = (entitySlug: string): string => {
  if (entitySlug.endsWith('s')) {
    return entitySlug
  }

  if (entitySlug.endsWith('y')) {
    return `${entitySlug.slice(0, -1)}ies`
  }

  return `${entitySlug}s`
}

const buildNames = (input: CrudScaffoldInput): NameSet => {
  ensureValidName(input.domain, 'domain')
  ensureValidName(input.entity, 'entity')
  if (input.plural) {
    ensureValidName(input.plural, 'plural')
  }

  const domainSlug = toKebabCase(input.domain)
  const entitySlug = toKebabCase(input.entity)
  const pluralSlug = input.plural ? toKebabCase(input.plural) : inferPlural(entitySlug)

  return {
    domainSlug,
    entitySlug,
    pluralSlug,
    Domain: toPascalCase(domainSlug),
    Entity: toPascalCase(entitySlug),
    Entities: toPascalCase(pluralSlug),
    entity: toCamelCase(entitySlug)
  }
}

const coreDomainFile = (n: NameSet): string => `import * as Schema from 'effect/Schema'

export const ${n.Entity}IdSchema = Schema.String.pipe(Schema.brand('${n.Entity}Id'))
export type ${n.Entity}Id = Schema.Schema.Type<typeof ${n.Entity}IdSchema>
export const ${n.Entities}CollectionName = '${n.pluralSlug}' as const

export const ${n.Entity}Schema = Schema.Struct({
  id: ${n.Entity}IdSchema,
  name: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type ${n.Entity} = Schema.Schema.Type<typeof ${n.Entity}Schema>

export const Create${n.Entity}InputSchema = Schema.Struct({
  name: Schema.String
})

export type Create${n.Entity}Input = Schema.Schema.Type<typeof Create${n.Entity}InputSchema>

export const Update${n.Entity}InputSchema = Schema.Struct({
  id: ${n.Entity}IdSchema,
  name: Schema.optional(Schema.String)
})

export type Update${n.Entity}Input = Schema.Schema.Type<typeof Update${n.Entity}InputSchema>
`

const corePortFile = (n: NameSet): string => `import type { Effect } from 'effect'
import type { CoreError } from '../../../errors.js'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '../domain/${n.entitySlug}.js'

export const ${n.Entity}RepositoryKind = 'crud' as const

export interface ${n.Entity}StorePort {
  list: () => Effect.Effect<ReadonlyArray<${n.Entity}>, CoreError>
  getById: (id: ${n.Entity}Id) => Effect.Effect<${n.Entity}, CoreError>
  create: (input: Create${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  update: (input: Update${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  remove: (id: ${n.Entity}Id) => Effect.Effect<{ deleted: true }, CoreError>
}
`

const coreRepositoryFile = (n: NameSet): string => `import { Effect } from 'effect'
import { notFound, type CoreError } from '../../../errors.js'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '../domain/${n.entitySlug}.js'
import type { ${n.Entity}StorePort } from '../ports/${n.entitySlug}-store-port.js'

export interface Make${n.Entity}StoreAdapterOptions {
  now?: () => string
  idFactory?: () => ${n.Entity}Id
}

export const make${n.Entity}StoreAdapter = (
  options: Make${n.Entity}StoreAdapterOptions = {}
): ${n.Entity}StorePort => {
  const records = new Map<string, ${n.Entity}>()
  const now = options.now ?? (() => new Date().toISOString())
  let nextId = 1
  const idFactory = options.idFactory ?? (() => ('${n.entitySlug}-' + String(nextId++)) as ${n.Entity}Id)

  const getExisting = (id: ${n.Entity}Id): Effect.Effect<${n.Entity}, CoreError> => {
    const existing = records.get(id)
    if (!existing) {
      return Effect.fail(notFound('${n.Entity} not found'))
    }
    return Effect.succeed(existing)
  }

  return {
    list: () => Effect.succeed(Array.from(records.values())),
    getById: (id) => getExisting(id),
    create: (input) => {
      const timestamp = now()
      const entity: ${n.Entity} = {
        id: idFactory(),
        name: input.name,
        createdAt: timestamp,
        updatedAt: timestamp
      }

      records.set(entity.id, entity)
      return Effect.succeed(entity)
    },
    update: (input) =>
      Effect.gen(function* () {
        const existing = yield* getExisting(input.id)
        const updated: ${n.Entity} = {
          ...existing,
          name: input.name ?? existing.name,
          updatedAt: now()
        }

        records.set(updated.id, updated)
        return updated
      }),
    remove: (id) =>
      Effect.gen(function* () {
        yield* getExisting(id)
        records.delete(id)
        return { deleted: true as const }
      })
  }
}
`

const coreServiceFile = (n: NameSet): string => `import { Context, Effect, Layer } from 'effect'
import type { CoreError } from '../../../errors.js'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '../domain/${n.entitySlug}.js'
import type { ${n.Entity}StorePort } from '../ports/${n.entitySlug}-store-port.js'

export interface ${n.Entity}ServiceContract {
  list: () => Effect.Effect<ReadonlyArray<${n.Entity}>, CoreError>
  getById: (id: ${n.Entity}Id) => Effect.Effect<${n.Entity}, CoreError>
  create: (input: Create${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  update: (input: Update${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  remove: (id: ${n.Entity}Id) => Effect.Effect<{ deleted: true }, CoreError>
}

export class ${n.Entity}Service extends Context.Tag('${n.Entity}Service')<${n.Entity}Service, ${n.Entity}ServiceContract>() {}

export interface Make${n.Entity}ServiceOptions {
  store: ${n.Entity}StorePort
}

export const make${n.Entity}Service = (options: Make${n.Entity}ServiceOptions): ${n.Entity}ServiceContract => ({
  list: () => options.store.list(),
  getById: (id) => options.store.getById(id),
  create: (input) => options.store.create(input),
  update: (input) => options.store.update(input),
  remove: (id) => options.store.remove(id)
})

export const ${n.Entity}ServiceLive = (options: Make${n.Entity}ServiceOptions) =>
  Layer.succeed(${n.Entity}Service, make${n.Entity}Service(options))
`

const coreRuntimeFile = (n: NameSet): string => `import { make${n.Entity}StoreAdapter } from '../adapters/${n.entitySlug}-store-adapter.js'
import { ${n.Entity}ServiceLive } from '../application/${n.entitySlug}-service.js'

export const ${n.Entity}DomainLive = ${n.Entity}ServiceLive({
  store: make${n.Entity}StoreAdapter()
})
`

const coreServiceTestFile = (n: NameSet): string => `import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { make${n.Entity}StoreAdapter } from '../adapters/${n.entitySlug}-store-adapter.js'
import { make${n.Entity}Service } from '../application/${n.entitySlug}-service.js'

describe('${n.Entity}Service', () => {
  it('runs create -> list -> getById -> update -> remove CRUD flow', async () => {
    const store = make${n.Entity}StoreAdapter({
      now: () => '2026-01-01T00:00:00.000Z'
    })

    const service = make${n.Entity}Service({ store })

    const created = await Effect.runPromise(service.create({ name: '${n.Entity} Name' }))
    expect(created.name).toBe('${n.Entity} Name')

    const listed = await Effect.runPromise(service.list())
    expect(listed).toHaveLength(1)

    const found = await Effect.runPromise(service.getById(created.id))
    expect(found.id).toBe(created.id)

    const updated = await Effect.runPromise(service.update({ id: created.id, name: '${n.Entity} Updated' }))
    expect(updated.name).toBe('${n.Entity} Updated')

    const removed = await Effect.runPromise(service.remove(created.id))
    expect(removed.deleted).toBe(true)

    const afterDelete = await Effect.runPromise(service.list())
    expect(afterDelete).toHaveLength(0)
  })
})
`

const apiDomainFile = (n: NameSet): string => `import * as Schema from 'effect/Schema'

export const ${n.Entity}RouteIdSchema = Schema.Struct({
  id: Schema.String
})

export type ${n.Entity}RouteId = Schema.Schema.Type<typeof ${n.Entity}RouteIdSchema>

export const ${n.Entity}CreateRouteSchema = Schema.Struct({
  name: Schema.String
})

export type ${n.Entity}CreateRoute = Schema.Schema.Type<typeof ${n.Entity}CreateRouteSchema>

export const ${n.Entity}UpdateRouteSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String)
})

export type ${n.Entity}UpdateRoute = Schema.Schema.Type<typeof ${n.Entity}UpdateRouteSchema>
`

const apiPortFile = (n: NameSet): string => `import type { Effect } from 'effect'
import type { CoreError } from '@tx-agent-kit/core'
import type { ${n.Entity}, ${n.Entity}Id, Create${n.Entity}Input, Update${n.Entity}Input } from '@tx-agent-kit/core'

export interface ${n.Entity}RoutePort {
  list: () => Effect.Effect<ReadonlyArray<${n.Entity}>, CoreError>
  getById: (id: ${n.Entity}Id) => Effect.Effect<${n.Entity}, CoreError>
  create: (input: Create${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  update: (input: Update${n.Entity}Input) => Effect.Effect<${n.Entity}, CoreError>
  remove: (id: ${n.Entity}Id) => Effect.Effect<{ deleted: true }, CoreError>
}
`

const apiRepositoryFile = (n: NameSet): string => `import type { ${n.Entity}ServiceContract } from '@tx-agent-kit/core'
import type { ${n.Entity}RoutePort } from '../ports/${n.entitySlug}-route-port.js'

export interface Make${n.Entity}ServiceAdapterOptions {
  service: ${n.Entity}ServiceContract
}

export const make${n.Entity}ServiceAdapter = (options: Make${n.Entity}ServiceAdapterOptions): ${n.Entity}RoutePort => ({
  list: () => options.service.list(),
  getById: (id) => options.service.getById(id),
  create: (input) => options.service.create(input),
  update: (input) => options.service.update(input),
  remove: (id) => options.service.remove(id)
})
`

const apiServiceFile = (n: NameSet): string => `import type { ${n.Entity}RoutePort } from '../ports/${n.entitySlug}-route-port.js'

export interface ${n.Entity}RouteServiceContract extends ${n.Entity}RoutePort {}

export interface Make${n.Entity}RouteServiceOptions {
  routes: ${n.Entity}RoutePort
}

export const make${n.Entity}RouteService = (options: Make${n.Entity}RouteServiceOptions): ${n.Entity}RouteServiceContract => ({
  list: () => options.routes.list(),
  getById: (id) => options.routes.getById(id),
  create: (input) => options.routes.create(input),
  update: (input) => options.routes.update(input),
  remove: (id) => options.routes.remove(id)
})
`

const apiRoutesFile = (n: NameSet): string => `import type {
  Create${n.Entity}Input,
  ${n.Entity}Id,
  Update${n.Entity}Input
} from '@tx-agent-kit/core'
import type { ${n.Entity}RouteServiceContract } from '../application/${n.entitySlug}-route-service.js'

export interface Make${n.Entity}RoutesOptions {
  service: ${n.Entity}RouteServiceContract
}

export const ${n.Entity}RoutesPath = '/${n.pluralSlug}' as const
export const ${n.Entity}RouteKind = 'crud' as const

export const make${n.Entity}Routes = (options: Make${n.Entity}RoutesOptions) => ({
  list: () => options.service.list(),
  getById: (id: ${n.Entity}Id) => options.service.getById(id),
  create: (payload: Create${n.Entity}Input) => options.service.create(payload),
  update: (payload: Update${n.Entity}Input) => options.service.update(payload),
  remove: (id: ${n.Entity}Id) => options.service.remove(id)
})
`

const apiRoutesTestFile = (n: NameSet): string => `import { ${n.Entity}IdSchema } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { make${n.Entity}Routes } from '../routes/${n.entitySlug}.js'

describe('${n.Entity} routes scaffold', () => {
  it('delegates CRUD calls to the service layer', async () => {
    const routes = make${n.Entity}Routes({
      service: {
        list: () => Effect.succeed([]),
        getById: () => Effect.dieMessage('not-used'),
        create: () => Effect.dieMessage('not-used'),
        update: () => Effect.dieMessage('not-used'),
        remove: () => Effect.succeed({ deleted: true as const })
      }
    })

    const id = Schema.decodeUnknownSync(${n.Entity}IdSchema)('id-1')
    const removed = await Effect.runPromise(routes.remove(id))
    expect(removed.deleted).toBe(true)
  })
})
`

const indexFile = (exportTargets: string[]): string =>
  exportTargets.map((target) => `export * from './${target}.js'`).join('\n').concat('\n')

const exportLineRegex = /^export \* from ['"]\.\/[^'"]+\.js['"]$/

const extractExportLines = (content: string): string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => exportLineRegex.test(line))

const mergeIndexExports = async (absolutePath: string, plannedContent: string): Promise<boolean> => {
  const current = await readFile(absolutePath, 'utf8')
  const plannedLines = extractExportLines(plannedContent)
  const currentSet = new Set(extractExportLines(current))
  const missingLines = plannedLines.filter((line) => !currentSet.has(line))

  if (missingLines.length === 0) {
    return false
  }

  const currentWithNewline = current.endsWith('\n') ? current : `${current}\n`
  await writeFile(absolutePath, `${currentWithNewline}${missingLines.join('\n')}\n`, 'utf8')
  return true
}

const domainRootIndexFile = (): string => `export * from './domain/index.js'
export * from './ports/index.js'
export * from './application/index.js'
export * from './adapters/index.js'
export * from './runtime/index.js'
`

const apiDomainRootIndexFile = (): string => `export * from './domain/index.js'
export * from './ports/index.js'
export * from './application/index.js'
export * from './adapters/index.js'
export * from './routes/index.js'
`

const coreFilePlan = (n: NameSet): PlannedFile[] => {
  const basePath = `packages/core/src/domains/${n.domainSlug}`

  return [
    { path: `${basePath}/domain/${n.entitySlug}.ts`, content: coreDomainFile(n) },
    { path: `${basePath}/domain/index.ts`, content: indexFile([n.entitySlug]) },
    { path: `${basePath}/ports/${n.entitySlug}-store-port.ts`, content: corePortFile(n) },
    { path: `${basePath}/ports/index.ts`, content: indexFile([`${n.entitySlug}-store-port`]) },
    { path: `${basePath}/adapters/${n.entitySlug}-store-adapter.ts`, content: coreRepositoryFile(n) },
    { path: `${basePath}/adapters/index.ts`, content: indexFile([`${n.entitySlug}-store-adapter`]) },
    { path: `${basePath}/application/${n.entitySlug}-service.ts`, content: coreServiceFile(n) },
    { path: `${basePath}/application/index.ts`, content: indexFile([`${n.entitySlug}-service`]) },
    { path: `${basePath}/runtime/${n.entitySlug}-live.ts`, content: coreRuntimeFile(n) },
    { path: `${basePath}/runtime/index.ts`, content: indexFile([`${n.entitySlug}-live`]) },
    { path: `${basePath}/application/${n.entitySlug}-service.test.ts`, content: coreServiceTestFile(n) },
    { path: `${basePath}/index.ts`, content: domainRootIndexFile() }
  ]
}

const apiFilePlan = (n: NameSet): PlannedFile[] => {
  const basePath = `apps/api/src/domains/${n.domainSlug}`

  return [
    { path: `${basePath}/domain/${n.entitySlug}-contracts.ts`, content: apiDomainFile(n) },
    { path: `${basePath}/domain/index.ts`, content: indexFile([`${n.entitySlug}-contracts`]) },
    { path: `${basePath}/ports/${n.entitySlug}-route-port.ts`, content: apiPortFile(n) },
    { path: `${basePath}/ports/index.ts`, content: indexFile([`${n.entitySlug}-route-port`]) },
    { path: `${basePath}/adapters/${n.entitySlug}-service-adapter.ts`, content: apiRepositoryFile(n) },
    { path: `${basePath}/adapters/index.ts`, content: indexFile([`${n.entitySlug}-service-adapter`]) },
    { path: `${basePath}/application/${n.entitySlug}-route-service.ts`, content: apiServiceFile(n) },
    { path: `${basePath}/application/index.ts`, content: indexFile([`${n.entitySlug}-route-service`]) },
    { path: `${basePath}/routes/${n.entitySlug}.ts`, content: apiRoutesFile(n) },
    { path: `${basePath}/routes/index.ts`, content: indexFile([n.entitySlug]) },
    { path: `${basePath}/routes/${n.entitySlug}.test.ts`, content: apiRoutesTestFile(n) },
    { path: `${basePath}/index.ts`, content: apiDomainRootIndexFile() }
  ]
}

interface DbNameSet {
  tableConst: string
  tableSqlName: string
  tableFileSlug: string
}

const buildDbNames = (n: NameSet): DbNameSet => {
  const tableFileSlug = `${n.domainSlug}-${n.pluralSlug}`
  return {
    tableConst: toCamelCase(tableFileSlug),
    tableSqlName: tableFileSlug.replace(/-/g, '_'),
    tableFileSlug
  }
}

const dbEffectSchemaFile = (n: NameSet): string => `import * as Schema from 'effect/Schema'

export const ${n.entity}RowSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type ${n.Entity}RowShape = Schema.Schema.Type<typeof ${n.entity}RowSchema>
`

const dbFactoryFile = (n: NameSet, db: DbNameSet): string => `import type { ${db.tableConst} } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type ${n.Domain}${n.Entity}Insert = typeof ${db.tableConst}.$inferInsert

export interface Create${n.Domain}${n.Entity}FactoryOptions {
  id?: string
  name?: string
  createdAt?: Date
  updatedAt?: Date
}

export const create${n.Domain}${n.Entity}Factory = (
  options: Create${n.Domain}${n.Entity}FactoryOptions = {}
): ${n.Domain}${n.Entity}Insert => {
  const createdAt = options.createdAt ?? generateTimestamp()
  return {
    id: options.id ?? generateId(),
    name: options.name ?? generateUniqueValue('${n.Domain}${n.Entity}'),
    createdAt,
    updatedAt: options.updatedAt ?? createdAt
  }
}
`

const dbRepositoryFile = (n: NameSet, db: DbNameSet): string => `import { eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { ${n.entity}RowSchema, type ${n.Entity}RowShape } from '../effect-schemas/${db.tableFileSlug}.js'
import { dbDecodeFailed, dbQueryFailed, toDbError, type DbError } from '../errors.js'
import { ${db.tableConst} } from '../schema.js'

const decode${n.Entity}Rows = Schema.decodeUnknown(Schema.Array(${n.entity}RowSchema))
const decode${n.Entity}Row = Schema.decodeUnknown(${n.entity}RowSchema)

const decodeNullable${n.Entity} = (
  value: unknown
): Effect.Effect<${n.Entity}RowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decode${n.Entity}Row(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('${n.Domain}${n.Entity} row decode failed', error))
  )
}

export const ${n.entity}DbRepository = {
  list: () =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.select().from(${db.tableConst}).execute()
        return yield* decode${n.Entity}Rows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('${n.Domain}${n.Entity} list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list ${n.Domain}${n.Entity} rows', error))),

  getById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.select().from(${db.tableConst}).where(eq(${db.tableConst}.id, id)).limit(1).execute()
        return yield* decodeNullable${n.Entity}(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get ${n.Domain}${n.Entity} row by id', error))),

  create: (input: { name: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(${db.tableConst})
          .values({ name: input.name })
          .returning()
          .execute()
        return yield* decodeNullable${n.Entity}(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create ${n.Domain}${n.Entity} row', error))),

  update: (input: { id: string; name?: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: {
          name?: string
          updatedAt: Date
        } = {
          updatedAt: new Date()
        }

        if (input.name !== undefined) {
          patch.name = input.name
        }

        const rows = yield* db
          .update(${db.tableConst})
          .set(patch)
          .where(eq(${db.tableConst}.id, input.id))
          .returning()
          .execute()
        return yield* decodeNullable${n.Entity}(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update ${n.Domain}${n.Entity} row', error))),

  remove: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.delete(${db.tableConst}).where(eq(${db.tableConst}.id, id)).returning().execute()
        const deleted = yield* decodeNullable${n.Entity}(rows[0] ?? null)
        if (!deleted) {
          return yield* Effect.fail(dbQueryFailed('${n.Domain}${n.Entity} row not found', new Error(id)))
        }

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete ${n.Domain}${n.Entity} row', error)))
}
`

const dbFilePlan = (n: NameSet): PlannedFile[] => {
  const dbNames = buildDbNames(n)
  return [
    {
      path: `packages/db/src/effect-schemas/${dbNames.tableFileSlug}.ts`,
      content: dbEffectSchemaFile(n)
    },
    {
      path: `packages/db/src/factories/${dbNames.tableFileSlug}.factory.ts`,
      content: dbFactoryFile(n, dbNames)
    },
    {
      path: `packages/db/src/repositories/${dbNames.tableFileSlug}.ts`,
      content: dbRepositoryFile(n, dbNames)
    }
  ]
}

export const planCrudScaffold = (
  input: CrudScaffoldInput,
  options: { withDb?: boolean } = {}
): PlannedFile[] => {
  const names = buildNames(input)
  const basePlan = [...coreFilePlan(names), ...apiFilePlan(names)]
  if (!options.withDb) {
    return basePlan
  }

  return [...basePlan, ...dbFilePlan(names)]
}

const ensureBarrelExport = async (repoRoot: string, domainSlug: string): Promise<boolean> => {
  const coreIndexPath = join(repoRoot, 'packages/core/src/index.ts')
  const exportLine = `export * from './domains/${domainSlug}/index.js'`

  if (!existsSync(coreIndexPath)) {
    return false
  }

  const current = await readFile(coreIndexPath, 'utf8')
  if (current.includes(exportLine)) {
    return false
  }

  const next = current.endsWith('\n')
    ? `${current}${exportLine}\n`
    : `${current}\n${exportLine}\n`

  await writeFile(coreIndexPath, next, 'utf8')
  return true
}

const ensureLineInFile = async (
  repoRoot: string,
  relativePath: string,
  line: string
): Promise<boolean> => {
  const absolutePath = join(repoRoot, relativePath)
  if (!existsSync(absolutePath)) {
    return false
  }

  const current = await readFile(absolutePath, 'utf8')
  if (current.includes(line)) {
    return false
  }

  const next = current.endsWith('\n') ? `${current}${line}\n` : `${current}\n${line}\n`
  await writeFile(absolutePath, next, 'utf8')
  return true
}

const ensureDbSchemaTable = async (repoRoot: string, names: NameSet): Promise<boolean> => {
  const schemaPath = join(repoRoot, 'packages/db/src/schema.ts')
  if (!existsSync(schemaPath)) {
    return false
  }

  const dbNames = buildDbNames(names)
  const tableDeclaration = `export const ${dbNames.tableConst} = pgTable('${dbNames.tableSqlName}', {`
  const rowTypeDeclaration = `export type ${names.Domain}${names.Entity}Row = typeof ${dbNames.tableConst}.$inferSelect`
  const current = await readFile(schemaPath, 'utf8')

  if (current.includes(tableDeclaration)) {
    return false
  }

  const snippet = `
export const ${dbNames.tableConst} = pgTable('${dbNames.tableSqlName}', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

${rowTypeDeclaration}
`

  const marker = 'export const usersRelations = relations(users, ({ many }) => ({'
  const next = current.includes(marker)
    ? current.replace(marker, `${snippet}\n${marker}`)
    : `${current}\n${snippet}\n`

  await writeFile(schemaPath, next, 'utf8')
  return true
}

const ensureDbScaffoldWiring = async (
  repoRoot: string,
  names: NameSet
): Promise<string[]> => {
  const dbNames = buildDbNames(names)
  const updated: string[] = []

  if (await ensureDbSchemaTable(repoRoot, names)) {
    updated.push('packages/db/src/schema.ts')
  }

  if (
    await ensureLineInFile(
      repoRoot,
      'packages/db/src/effect-schemas/index.ts',
      `export * from './${dbNames.tableFileSlug}.js'`
    )
  ) {
    updated.push('packages/db/src/effect-schemas/index.ts')
  }

  if (
    await ensureLineInFile(
      repoRoot,
      'packages/db/src/factories/index.ts',
      `export * from './${dbNames.tableFileSlug}.factory.js'`
    )
  ) {
    updated.push('packages/db/src/factories/index.ts')
  }

  if (
    await ensureLineInFile(
      repoRoot,
      'packages/db/src/index.ts',
      `export { ${names.entity}DbRepository } from './repositories/${dbNames.tableFileSlug}.js'`
    )
  ) {
    updated.push('packages/db/src/index.ts')
  }

  return updated
}

export const applyCrudScaffold = async (options: CrudScaffoldOptions): Promise<ApplyScaffoldResult> => {
  const plan = planCrudScaffold(options, { withDb: options.withDb })
  const written: string[] = []
  const skipped: string[] = []
  const updatedBarrels: string[] = []

  if (!options.dryRun) {
    for (const file of plan) {
      const absolutePath = join(options.repoRoot, file.path)
      await mkdir(dirname(absolutePath), { recursive: true })

      const exists = existsSync(absolutePath)
      const isIndexPath = file.path.endsWith('/index.ts')
      if (exists) {
        if (isIndexPath) {
          const merged = await mergeIndexExports(absolutePath, file.content)
          if (merged) {
            written.push(file.path)
          } else {
            skipped.push(file.path)
          }
          continue
        }

        if (!options.force) {
          skipped.push(file.path)
          continue
        }
      }

      await writeFile(absolutePath, file.content, 'utf8')
      written.push(file.path)
    }

    const names = buildNames(options)
    if (await ensureBarrelExport(options.repoRoot, names.domainSlug)) {
      updatedBarrels.push('packages/core/src/index.ts')
    }

    if (options.withDb) {
      const updatedDbFiles = await ensureDbScaffoldWiring(options.repoRoot, names)
      updatedBarrels.push(...updatedDbFiles)
    }
  }

  return {
    written,
    skipped,
    updatedBarrels,
    planned: plan.map((file) => file.path)
  }
}

export const parseCrudArgs = (
  argv: string[]
): CrudScaffoldInput & { dryRun: boolean; force: boolean; withDb: boolean } => {
  let domain = ''
  let entity = ''
  let plural: string | undefined
  let dryRun = false
  let force = false
  let withDb = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--domain' && next) {
      domain = next
      i += 1
      continue
    }

    if (arg === '--entity' && next) {
      entity = next
      i += 1
      continue
    }

    if (arg === '--plural' && next) {
      plural = next
      i += 1
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--force') {
      force = true
      continue
    }

    if (arg === '--with-db') {
      withDb = true
      continue
    }
  }

  if (!domain || !entity) {
    throw new Error('Usage: --domain <name> --entity <name> [--plural <name>] [--dry-run] [--force] [--with-db]')
  }

  return { domain, entity, plural, dryRun, force, withDb }
}

export const scaffoldSummary = async (options: CrudScaffoldOptions): Promise<string> => {
  const result = await applyCrudScaffold(options)

  const lines = [
    `Planned files: ${result.planned.length}`,
    `Written files: ${result.written.length}`,
    `Skipped files: ${result.skipped.length}`,
    `Updated barrels: ${result.updatedBarrels.length}`
  ]

  if (options.dryRun) {
    lines.push('Dry run only: no files were written.')
  }

  return lines.join('\n')
}

export const inspectFile = async (path: string): Promise<{ exists: boolean; size: number }> => {
  if (!existsSync(path)) {
    return { exists: false, size: 0 }
  }

  const fileStat = await stat(path)
  return {
    exists: true,
    size: fileStat.size
  }
}
