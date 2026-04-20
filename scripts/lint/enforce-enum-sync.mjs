#!/usr/bin/env node

/**
 * Verifies that every pgEnum() call in schema.ts references an array imported
 * from @tx-agent-kit/contracts (literals.ts). This ensures enum values in the
 * DB schema can never drift from the contract definitions.
 *
 * The check works by parsing the schema source for:
 *   pgEnum('enum_name', importedArray)
 * and verifying that `importedArray` appears in the import block from contracts.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const schemaPath = resolve(repoRoot, 'packages/infra/db/src/schema.ts')

const schemaSource = readFileSync(schemaPath, 'utf8')

// Extract what's imported from @tx-agent-kit/contracts
const contractImportMatch = schemaSource.match(
  /import\s*\{([^}]+)\}\s*from\s*['"]@tx-agent-kit\/contracts['"]/s
)

if (!contractImportMatch) {
  console.error('Could not find @tx-agent-kit/contracts import in schema.ts')
  process.exit(1)
}

const contractImports = new Set(
  contractImportMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/^type\s+/, ''))
    .filter((s) => s.length > 0)
)

// Find all pgEnum() calls
const pgEnumPattern = /pgEnum\(\s*['"](\w+)['"]\s*,\s*(\w+)\s*\)/g
const errors = []
let match

while ((match = pgEnumPattern.exec(schemaSource)) !== null) {
  const enumName = match[1]
  const arrayRef = match[2]

  if (!contractImports.has(arrayRef)) {
    errors.push(
      `pgEnum('${enumName}', ${arrayRef}) uses a local array, not an import from @tx-agent-kit/contracts. ` +
      `Define the values as a const array in packages/contracts/src/literals.ts and import it.`
    )
  }
}

if (errors.length > 0) {
  console.error('Enum sync check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Enum sync check passed.')
