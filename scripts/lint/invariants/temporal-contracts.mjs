import { existsSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import {
  listFilesRecursively,
  readUtf8,
  repoRoot
} from './utils.mjs'

export const enforceRpcPlacement = (errors) => {
  const dbRoot = resolve(repoRoot, 'packages/infra/db')
  const allowedRpcDir = resolve(dbRoot, 'src/rpcs')
  const migrationsDir = resolve(dbRoot, 'drizzle/migrations')
  const pgtapDir = resolve(dbRoot, 'pgtap')

  const sqlFiles = listFilesRecursively(dbRoot)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith(migrationsDir))
    .filter((f) => !f.startsWith(pgtapDir))

  for (const filePath of sqlFiles) {
    const content = readUtf8(filePath)
    const hasNonTriggerFunction =
      /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(content) &&
      !/RETURNS\s+trigger/i.test(content)

    if (hasNonTriggerFunction && !filePath.startsWith(allowedRpcDir)) {
      errors.push(
        `RPC/function definition found outside packages/infra/db/src/rpcs/: ${relative(repoRoot, filePath)}. ` +
        'Move non-trigger SQL functions to packages/infra/db/src/rpcs/.'
      )
    }
  }
}

export const enforceMigrationNamingConvention = (errors) => {
  const migrationsDir = resolve(repoRoot, 'packages/infra/db/drizzle/migrations')
  if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
    return
  }

  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const migrationNameRegex = /^\d{4}_[a-z][a-z0-9_]*\.sql$/
  for (const file of migrationFiles) {
    if (!migrationNameRegex.test(file)) {
      errors.push(
        `Migration file \`${file}\` does not match the naming convention \`NNNN_snake_case_description.sql\`.`
      )
    }
  }

  const prefixes = migrationFiles.map((f) => f.slice(0, 4))
  const seen = new Set()
  for (let i = 0; i < prefixes.length; i++) {
    const prefix = prefixes[i]
    if (seen.has(prefix)) {
      errors.push(
        `Duplicate migration prefix \`${prefix}\` found: \`${migrationFiles[i]}\`. Each migration must have a unique sequential prefix.`
      )
    }
    seen.add(prefix)
  }
}
