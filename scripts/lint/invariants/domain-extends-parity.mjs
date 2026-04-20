// Structural lint: verify domain record types extend/alias their DB row shapes.
// Scans domain files for exported interfaces/types ending in "Record".
// Verifies they extend or alias a row shape from @tx-agent-kit/db.
// Flags domain records that manually define all fields instead of extending.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { repoRoot, toPosix } from './utils.mjs'

const coreDomainsDir = resolve(repoRoot, 'packages/core/src/domains')

const ROW_SHAPE_PATTERN = /RowShape|Row\b/
const EXTENDS_PATTERN = /extends\s+(?:Omit|Pick|Readonly)?\s*<?\s*\w*(?:RowShape|Row)\b/
const TYPE_ALIAS_PATTERN = /=\s*(?:Omit|Pick|Readonly)?\s*<?\s*\w*(?:RowShape|Row)\b/
const IMPORT_DB_PATTERN = /from\s+['"]@tx-agent-kit\/db['"]/

// Records that are genuinely NOT backed by a single DB table
// (computed aggregations, command objects, joined views)
const EXCLUDED_RECORDS = new Set([
  'UsageSummaryRecord',     // aggregated view, not a single DB row
])

export const enforceDomainExtendsRowShape = (errors) => {
  if (!statSync(coreDomainsDir, { throwIfNoEntry: false })?.isDirectory()) {
    return
  }

  const domainDirs = readdirSync(coreDomainsDir)
    .map((d) => resolve(coreDomainsDir, d))
    .filter((d) => statSync(d).isDirectory())

  for (const domainDir of domainDirs) {
    const domainSubDir = resolve(domainDir, 'domain')
    if (!statSync(domainSubDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue
    }

    const files = readdirSync(domainSubDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => resolve(domainSubDir, f))

    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf8')
      const relPath = toPosix(relative(repoRoot, filePath))

      // Check if file imports from @tx-agent-kit/db
      const hasDbImport = IMPORT_DB_PATTERN.test(source)

      // Find all exported interface/type declarations ending in "Record"
      const recordPattern = /export\s+(?:interface|type)\s+(\w+Record)\b/g
      let match
      while ((match = recordPattern.exec(source)) !== null) {
        const recordName = match[1]

        if (EXCLUDED_RECORDS.has(recordName)) {
          continue
        }

        if (!hasDbImport) {
          errors.push(
            `Domain record \`${recordName}\` in \`${relPath}\` does not import from \`@tx-agent-kit/db\`. ` +
            `Domain records should extend their DB row shape type (e.g. \`extends TeamRowShape\` or \`= TeamRowShape\`).`
          )
          continue
        }

        // Check if this specific record extends or aliases a row shape
        // Get the declaration line and a few lines after it
        const declStart = match.index
        const declEnd = source.indexOf('\n\n', declStart)
        const declBlock = source.slice(declStart, declEnd === -1 ? declStart + 500 : declEnd)

        const extendsRowShape = EXTENDS_PATTERN.test(declBlock)
        const aliasesRowShape = TYPE_ALIAS_PATTERN.test(declBlock)

        if (!extendsRowShape && !aliasesRowShape) {
          errors.push(
            `Domain record \`${recordName}\` in \`${relPath}\` does not extend or alias a DB row shape. ` +
            `Use \`extends Omit<XRowShape, ...>\` or \`type ${recordName} = XRowShape\` to inherit DB columns automatically.`
          )
        }
      }
    }
  }
}
