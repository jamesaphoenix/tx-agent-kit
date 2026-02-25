#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const tsxLoaderPath = resolve(repoRoot, 'node_modules/tsx/dist/loader.mjs')

const helpText = `
tx-agent-kit CLI

Usage:
  pnpm tx <command> [options]
  pnpm <script> [options]

Commands:
  db:trigger:new        Scaffold DB trigger migration + pgTAP contract.
  scaffold:crud         Scaffold a CRUD domain slice.

Examples:
  pnpm tx db:trigger:new --name normalize-project-email --table invitations
  pnpm tx scaffold:crud --domain billing --entity invoice --dry-run
  pnpm db:trigger:new --name workspace-billing-rollup --table tasks --events INSERT,UPDATE,DELETE
  pnpm scaffold:crud --domain billing --entity invoice --with-db
`.trim()

const parseCommand = (argv) => {
  let startIndex = 0
  while (argv[startIndex] === '--') {
    startIndex += 1
  }

  if (startIndex >= argv.length) {
    return { command: 'help', consumed: startIndex }
  }

  const [first, second, third] = argv.slice(startIndex)

  if (first === 'db' && second === 'trigger' && third === 'new') {
    return { command: 'db:trigger:new', consumed: startIndex + 3 }
  }

  if (first === 'scaffold' && second === 'crud') {
    return { command: 'scaffold:crud', consumed: startIndex + 2 }
  }

  return { command: first, consumed: startIndex + 1 }
}

const normalizePassthroughArgs = (argv) => {
  let startIndex = 0
  while (argv[startIndex] === '--') {
    startIndex += 1
  }

  return argv.slice(startIndex)
}

const run = (command, passthroughArgs) => {
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${helpText}\n`)
    return 0
  }

  if (command === 'db:trigger:new') {
    const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/db/new-trigger.mjs'), ...passthroughArgs], {
      cwd: process.cwd(),
      stdio: 'inherit'
    })

    if (result.error) {
      throw result.error
    }

    return result.status ?? 1
  }

  if (command === 'scaffold:crud') {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        tsxLoaderPath,
        resolve(repoRoot, 'packages/tooling/scaffold/src/cli.ts'),
        ...passthroughArgs
      ],
      {
        cwd: process.cwd(),
        stdio: 'inherit'
      }
    )

    if (result.error) {
      throw result.error
    }

    return result.status ?? 1
  }

  process.stderr.write(`Unknown command: ${command}\n\n${helpText}\n`)
  return 1
}

const main = () => {
  const argv = process.argv.slice(2)
  const parsed = parseCommand(argv)
  const passthroughArgs = normalizePassthroughArgs(argv.slice(parsed.consumed))
  const exitCode = run(parsed.command, passthroughArgs)
  process.exit(exitCode)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
