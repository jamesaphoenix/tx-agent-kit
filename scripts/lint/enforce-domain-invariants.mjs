#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { runAllInvariants } from './invariants/index.mjs'
import { readUtf8, repoRoot } from './invariants/utils.mjs'

const errors = runAllInvariants()

// ── INV-BILLING-001/002/007: Financial audit trail FK must be SET NULL ──────────
// credit_ledger and usage_records use ON DELETE SET NULL, not CASCADE.
// If someone changes the schema to CASCADE, this catches it. Financial audit
// tables must preserve 7-year tax compliance records even if an org is deleted.
const enforceFinancialAuditFkSetNull = (errorList) => {
  const schemaPath = resolve(repoRoot, 'packages/infra/db/src/schema.ts')
  if (!existsSync(schemaPath)) {
    return
  }

  const source = readUtf8(schemaPath)
  const financialTables = ['creditLedger', 'usageRecords']

  for (const tableName of financialTables) {
    // Find the table definition. pgTable() blocks terminate with a `])` or `})` line
    // at column 0, followed by a blank line or next `export`. Stop there to avoid
    // bleeding into downstream tables.
    const startPattern = new RegExp(`^export const ${tableName}\\s*=\\s*pgTable\\(`, 'm')
    const startMatch = startPattern.exec(source)
    if (!startMatch) {
      continue
    }
    const afterStart = source.slice(startMatch.index)
    const endMatch = afterStart.match(/^\s*\]?\)\s*$/m)
    const tableSource = endMatch
      ? afterStart.slice(0, (endMatch.index ?? 0) + endMatch[0].length)
      : afterStart

    // Isolate the organizationId field definition so references to other columns
    // (e.g., assetId) don't trigger false positives. Match to end of line.
    const orgLineMatch = tableSource.match(/organizationId:[^\n]*/)
    if (!orgLineMatch) {
      errorList.push(
        `[INV-BILLING-007] \`${tableName}\` has no \`organizationId\` column in schema.ts.`
      )
      continue
    }
    const orgLine = orgLineMatch[0]

    if (orgLine.includes("onDelete: 'cascade'") || orgLine.includes('onDelete: "cascade"')) {
      errorList.push(
        `[INV-BILLING-007] \`${tableName}.organizationId\` uses ON DELETE CASCADE. ` +
        'Financial audit tables must use ON DELETE SET NULL to preserve 7-year tax compliance records.'
      )
    }

    if (!orgLine.includes("onDelete: 'set null'") && !orgLine.includes('onDelete: "set null"')) {
      errorList.push(
        `[INV-BILLING-007] \`${tableName}.organizationId\` is missing explicit ON DELETE SET NULL. ` +
        'Financial audit tables require SET NULL to preserve audit trail on org deletion.'
      )
    }
  }
}

enforceFinancialAuditFkSetNull(errors)

if (errors.length > 0) {
  console.error('Domain invariant check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Domain invariant check passed.')
