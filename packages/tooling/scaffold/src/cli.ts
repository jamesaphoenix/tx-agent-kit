#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { CrudArgsUsage, parseCrudArgs, scaffoldSummary } from './index.js'

const helpText = `
${CrudArgsUsage}

Examples:
  pnpm scaffold:crud --domain billing --entity invoice --dry-run
  pnpm scaffold:crud --domain billing --entity invoice --with-db
`.trim()

const findRepoRoot = (startDir: string): string => {
  let current = resolve(startDir)

  while (true) {
    const packageJsonPath = resolve(current, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
        if (packageJson.name === 'tx-agent-kit') {
          return current
        }
      } catch {
        // Continue traversing parent directories if package.json is unreadable.
      }
    }

    const parent = dirname(current)
    if (parent === current) {
      break
    }

    current = parent
  }

  throw new Error('Unable to locate tx-agent-kit repository root from current working directory.')
}

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${helpText}\n`)
    return
  }

  const parsed = parseCrudArgs(argv)

  const summary = await scaffoldSummary({
    repoRoot: findRepoRoot(process.cwd()),
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
