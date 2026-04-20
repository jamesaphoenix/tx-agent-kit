#!/usr/bin/env node
/**
 * Generates reconcile_role_permissions.sql from the TypeScript permission policy.
 *
 * Usage:
 *   node --import tsx scripts/permissions-sync.mjs          # write the file
 *   node --import tsx scripts/permissions-sync.mjs --check  # exit 1 if file is stale (used by lint)
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderPermissionReconcileSql } from '../packages/contracts/src/permissions.js'

const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const sqlPath = resolve(repoRoot, 'packages/infra/db/schemas/permissions/reconcile_role_permissions.sql')

const isCheck = process.argv.includes('--check')

const generated = renderPermissionReconcileSql() + '\n'

if (isCheck) {
  if (!existsSync(sqlPath)) {
    console.error(`Missing: ${sqlPath}`)
    console.error('Run `pnpm permissions:sync` to generate it.')
    process.exit(1)
  }

  const current = readFileSync(sqlPath, 'utf8')
  if (current !== generated) {
    console.error('reconcile_role_permissions.sql is out of sync with packages/contracts/src/permissions.ts')
    console.error('Run `pnpm permissions:sync` to regenerate it.')
    process.exit(1)
  }

  console.log('reconcile_role_permissions.sql is in sync.')
  process.exit(0)
}

writeFileSync(sqlPath, generated)
console.log(`Wrote ${sqlPath}`)
