import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import type { Client } from 'pg'
import { isPostgresDuplicateTable, isPostgresUniqueViolation } from './errors.js'

export type SqlFile = {
  readonly name: string
  readonly sql: string
}

export const migrationsRelativePath = 'packages/infra/db/drizzle/migrations'
export const schemasRelativePath = 'packages/infra/db/schemas'

type SqlClient = Pick<Client, 'query'>

const readSqlFilesRecursively = (
  directory: string,
  prefix = ''
): ReadonlyArray<SqlFile> =>
  readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const fullPath = resolve(directory, entry.name)
      const nextPrefix = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        return readSqlFilesRecursively(fullPath, nextPrefix)
      }

      if (!entry.isFile() || !entry.name.endsWith('.sql')) {
        return []
      }

      return [
        {
          name: nextPrefix,
          sql: readFileSync(fullPath, 'utf8')
        }
      ]
    })

export const resolveRepoRoot = (start = process.cwd()): string => {
  let current = resolve(start)

  for (;;) {
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

export type DuplicateMigrationPrefix = {
  readonly prefix: string
  readonly files: ReadonlyArray<string>
}

// Extract the leading numeric prefix that orders a migration (e.g. "0050" from
// "0050_foo.sql"). Files without a numeric prefix fall back to their full name so
// they are still compared against one another rather than silently grouped.
const migrationPrefix = (fileName: string): string => /^(\d+)/u.exec(fileName)?.[1] ?? fileName

// Pure, side-effect-free detector: group migration file names by their numeric
// prefix and return only the groups that collide. Exported so the guard can be
// unit-tested without touching the filesystem.
export const findDuplicateMigrationPrefixes = (
  fileNames: ReadonlyArray<string>
): ReadonlyArray<DuplicateMigrationPrefix> => {
  const byPrefix = new Map<string, string[]>()
  for (const fileName of fileNames) {
    const prefix = migrationPrefix(fileName)
    const existing = byPrefix.get(prefix)
    if (existing) {
      existing.push(fileName)
    } else {
      byPrefix.set(prefix, [fileName])
    }
  }

  return [...byPrefix.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([prefix, files]) => ({
      prefix,
      files: [...files].sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => left.prefix.localeCompare(right.prefix))
}

// Fail fast when two migrations share a number. Without this, two branches that
// each took the same prefix (e.g. both `0050_*.sql`) merge cleanly into staging
// and BOTH get applied in alphabetical order - an order that can differ from the
// order they applied elsewhere, silently diverging schemas across environments.
// Raising here turns that into a hard error at the point migrations are loaded
// (migrator, deploy, `pnpm dev`, and every integration test) instead of a no-op.
export const assertUniqueMigrationPrefixes = (fileNames: ReadonlyArray<string>): void => {
  const duplicates = findDuplicateMigrationPrefixes(fileNames)
  if (duplicates.length === 0) {
    return
  }

  const details = duplicates
    .map(({ prefix, files }) => `migration number ${prefix} is used by ${files.join(', ')}`)
    .join('; ')

  throw new Error(
    `Duplicate migration numbers detected: ${details}. ` +
      'Renumber one migration so every file has a unique sequential prefix ' +
      '(this usually means two git branches both took the same number before merging).'
  )
}

export const getMigrationFiles = (
  repoRoot: string,
  relativePath = migrationsRelativePath
): ReadonlyArray<SqlFile> => {
  const migrationDir = resolve(repoRoot, relativePath)
  if (!existsSync(migrationDir)) {
    return []
  }

  const fileNames = readdirSync(migrationDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))

  assertUniqueMigrationPrefixes(fileNames)

  return fileNames.map((name) => ({
    name,
    sql: readFileSync(resolve(migrationDir, name), 'utf8')
  }))
}

export const getSchemaFiles = (
  repoRoot: string,
  relativePath = schemasRelativePath
): ReadonlyArray<SqlFile> => {
  const schemaDir = resolve(repoRoot, relativePath)
  if (!existsSync(schemaDir)) {
    return []
  }

  return readSqlFilesRecursively(schemaDir)
}

// CREATE TABLE IF NOT EXISTS checks existence BEFORE inserting the catalog
// rows, so two concurrent creators in the same schema can both pass the check
// and the loser fails with a unique violation on pg_type/pg_class, or a
// duplicate-table error. With multiple repos' CI sharing one Postgres this
// race is real (hit twice within 12h on the shared runner host). Losing the
// race MEANS the table exists - retry once and the IF NOT EXISTS no-ops.
export const ensureMigrationTable = async (client: SqlClient): Promise<void> => {
  const createMigrationTable = () =>
    client.query(`
    CREATE TABLE IF NOT EXISTS __tx_agent_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  try {
    await createMigrationTable()
  } catch (error) {
    if (!isPostgresUniqueViolation(error) && !isPostgresDuplicateTable(error)) {
      throw error
    }
    await createMigrationTable()
  }
}

export const applySqlFiles = async (
  client: SqlClient,
  sqlFiles: ReadonlyArray<SqlFile>,
  onApply?: (sqlFile: SqlFile) => void
): Promise<void> => {
  for (const sqlFile of sqlFiles) {
    onApply?.(sqlFile)
    await client.query(sqlFile.sql)
  }
}

const requiresOutOfTransactionExecution = (sql: string): boolean =>
  /ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE/iu.test(sql)

export const applySqlMigration = async (
  client: SqlClient,
  migration: SqlFile
): Promise<void> => {
  if (requiresOutOfTransactionExecution(migration.sql)) {
    await client.query(migration.sql)
    await client.query('BEGIN')
    try {
      await client.query('INSERT INTO __tx_agent_migrations (name) VALUES ($1)', [migration.name])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    return
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
