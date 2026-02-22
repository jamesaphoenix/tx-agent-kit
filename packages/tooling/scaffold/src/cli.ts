#!/usr/bin/env node

import { resolve } from 'node:path'
import process from 'node:process'
import { parseCrudArgs, scaffoldSummary } from './index.js'

const main = async (): Promise<void> => {
  const parsed = parseCrudArgs(process.argv.slice(2))

  const summary = await scaffoldSummary({
    repoRoot: resolve(process.cwd()),
    domain: parsed.domain,
    entity: parsed.entity,
    plural: parsed.plural,
    dryRun: parsed.dryRun,
    force: parsed.force,
    withDb: parsed.withDb
  })

  process.stdout.write(`${summary}\n`)
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
