import { existsSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

import {
  parseTypeScriptSourceFile,
  readUtf8,
  repoRoot,
  toPosix,
  unwrapTsExpression,
  getPropertyNameText
} from './utils.mjs'

/**
 * Parse schema.ts and return Map<sqlTableName, Set<sqlColumnName>>.
 * The SQL table name comes from the first argument to pgTable('table_name', { ... }).
 * The SQL column names come from the column builder call first argument: e.g. uuid('id'), text('name').
 */
const parseSchemaTablesAndColumns = (schemaPath) => {
  const source = readUtf8(schemaPath)
  const sourceFile = parseTypeScriptSourceFile(schemaPath, source)
  const tables = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) {
        continue
      }

      const init = unwrapTsExpression(decl.initializer)
      if (!ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'pgTable') {
        continue
      }

      // First argument: table name string
      const tableNameArg = init.arguments[0]
      if (!tableNameArg || !ts.isStringLiteral(tableNameArg)) {
        continue
      }

      const sqlTableName = tableNameArg.text

      // Second argument: columns object literal
      const columnsArg = init.arguments[1]
      if (!columnsArg || !ts.isObjectLiteralExpression(columnsArg)) {
        continue
      }

      const columns = new Set()
      for (const prop of columnsArg.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          continue
        }

        // Extract the SQL column name from the column builder call
        // e.g. uuid('id') -> 'id', text('name') -> 'name', bigint('file_size', ...) -> 'file_size'
        const colInit = unwrapTsExpression(prop.initializer)
        const sqlColName = extractSqlColumnName(colInit, sourceFile)
        if (sqlColName) {
          columns.add(sqlColName)
        }
      }

      tables.set(sqlTableName, columns)
    }
  }

  return tables
}

/**
 * Walk a column builder chain to find the root call and extract its first string argument.
 * e.g. `uuid('id').defaultRandom().primaryKey()` -> walk back to `uuid('id')` -> 'id'
 * e.g. `text('name').notNull()` -> walk back to `text('name')` -> 'name'
 * e.g. `assetTypeEnum('asset_type').notNull()` -> walk back to `assetTypeEnum('asset_type')` -> 'asset_type'
 */
const extractSqlColumnName = (expression, sourceFile) => {
  let current = expression

  // Walk through method chains: .notNull(), .default(...), .primaryKey(), etc.
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    current = unwrapTsExpression(current.expression.expression)
  }

  // Now current should be the root call like uuid('id') or text('name')
  if (ts.isCallExpression(current)) {
    const firstArg = current.arguments[0]
    if (firstArg && ts.isStringLiteral(firstArg)) {
      return firstArg.text
    }
  }

  return null
}

/**
 * Parse all migration SQL files and return Map<sqlTableName, Set<sqlColumnName>>.
 * Extracts from:
 *   - CREATE TABLE "table_name" (...columns...)
 *   - ALTER TABLE "table_name" ADD COLUMN "column_name" ...
 *
 * Handles quoted and unquoted identifiers, IF NOT EXISTS / IF EXISTS clauses,
 * and multi-line ALTER TABLE statements where ADD COLUMN appears on subsequent lines.
 */
const parseMigrationTablesAndColumns = (migrationsDir) => {
  const tables = new Map()
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const ensureTable = (name) => {
    if (!tables.has(name)) {
      tables.set(name, new Set())
    }
  }

  for (const file of migrationFiles) {
    const filePath = resolve(migrationsDir, file)
    const content = readUtf8(filePath)

    // ── Parse CREATE TABLE blocks ───────────────────────────────────────
    // Match: CREATE TABLE [IF NOT EXISTS] ["']table_name["'] ( ... );
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(([\s\S]*?)\);/gi
    for (const match of content.matchAll(createTableRegex)) {
      const tableName = match[1]
      const body = match[2]

      ensureTable(tableName)

      const lines = body.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (
          !trimmed ||
          /^\s*(?:CONSTRAINT|UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK)\b/i.test(trimmed) ||
          trimmed === ')'
        ) {
          continue
        }

        const colMatch = trimmed.match(/^["']?(\w+)["']?\s+/)
        if (colMatch) {
          const colName = colMatch[1]
          if (!/^(?:CONSTRAINT|UNIQUE|PRIMARY|FOREIGN|CHECK|INDEX|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|ON|REFERENCES|ADD)$/i.test(colName)) {
            tables.get(tableName).add(colName)
          }
        }
      }
    }

    // ── Parse ALTER TABLE ADD COLUMN statements ─────────────────────────
    // Handles all patterns:
    //   ALTER TABLE "table_name" ADD COLUMN "column_name" ...
    //   ALTER TABLE IF EXISTS table_name ADD COLUMN IF NOT EXISTS column_name ...
    //   ALTER TABLE table_name\n  ADD COLUMN column_name ...  (multi-line)
    //   ALTER TABLE table_name\n  ADD COLUMN col1 ...,\n  ADD COLUMN col2 ...  (multi-ADD)
    const alterTableRegex = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?\s*\n?([\s\S]*?)(?:;|$)/gi
    for (const match of content.matchAll(alterTableRegex)) {
      const tableName = match[1]
      const alterBody = match[2]

      // Extract all ADD COLUMN clauses from the ALTER body
      const addColRegex = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi
      for (const colMatch of alterBody.matchAll(addColRegex)) {
        ensureTable(tableName)
        tables.get(tableName).add(colMatch[1])
      }

      // Extract RENAME COLUMN clauses — the new name is effectively "added"
      // for coverage purposes (the old name is still in an earlier CREATE TABLE).
      const renameColRegex = /RENAME\s+COLUMN\s+["']?(\w+)["']?\s+TO\s+["']?(\w+)["']?/gi
      for (const colMatch of alterBody.matchAll(renameColRegex)) {
        ensureTable(tableName)
        tables.get(tableName).add(colMatch[2])
      }
    }
  }

  return tables
}

/**
 * Enforce that every table and column in schema.ts is covered by at least one migration.
 */
export const enforceMigrationCoversSchema = (errors) => {
  const schemaPath = resolve(repoRoot, 'packages/infra/db/src/schema.ts')
  if (!existsSync(schemaPath)) {
    return
  }

  const migrationsDir = resolve(repoRoot, 'packages/infra/db/drizzle/migrations')
  if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
    return
  }

  const schemaTablesAndCols = parseSchemaTablesAndColumns(schemaPath)
  const migrationTablesAndCols = parseMigrationTablesAndColumns(migrationsDir)

  const schemaRelPath = 'packages/infra/db/src/schema.ts'

  for (const [tableName, schemaCols] of schemaTablesAndCols) {
    const migrationCols = migrationTablesAndCols.get(tableName)
    if (!migrationCols) {
      errors.push(
        `Table \`${tableName}\` in \`${schemaRelPath}\` has no corresponding CREATE TABLE in any migration file.`
      )
      continue
    }

    for (const col of schemaCols) {
      if (!migrationCols.has(col)) {
        errors.push(
          `Column \`${tableName}.${col}\` in \`${schemaRelPath}\` is not covered by any migration ` +
          `(CREATE TABLE or ALTER TABLE ADD COLUMN).`
        )
      }
    }
  }
}
