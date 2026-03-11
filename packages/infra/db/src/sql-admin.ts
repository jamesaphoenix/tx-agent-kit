import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import type { Client } from 'pg'

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

export const getMigrationFiles = (
  repoRoot: string,
  relativePath = migrationsRelativePath
): ReadonlyArray<SqlFile> => {
  const migrationDir = resolve(repoRoot, relativePath)
  if (!existsSync(migrationDir)) {
    return []
  }

  return readdirSync(migrationDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
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

export const ensureMigrationTable = async (client: SqlClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS __tx_agent_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
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
