#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const usage = `
Usage:
  pnpm db:trigger:new --name <trigger-name> --table <table> [--timing BEFORE|AFTER] [--events INSERT,UPDATE] [--level ROW|STATEMENT]

Examples:
  pnpm db:trigger:new --name normalize-project-email --table invitations --timing BEFORE --events INSERT,UPDATE
  pnpm db:trigger:new --name workspace-billing-rollup --table tasks --timing AFTER --events INSERT,UPDATE,DELETE
`.trim()

const parseArgs = (argv) => {
  const options = {
    name: '',
    table: '',
    timing: 'BEFORE',
    events: 'INSERT',
    level: 'ROW'
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = 'true'
      continue
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }

    options[key] = next
    index += 1
  }

  return options
}

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .replace(/--+/gu, '-')

const toSnake = (value) => slugify(value).replace(/-/gu, '_')

const ensureIdentifier = (value, label) => {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error(`${label} must match ^[a-z][a-z0-9_]*$ (received: ${value})`)
  }
}

const ensureQualifiedTable = (value) => {
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/u.test(value)) {
    throw new Error(`table must be "<table>" or "<schema>.<table>" with snake_case identifiers (received: ${value})`)
  }
}

const getNextIndex = (entries, regex, width) => {
  let maxIndex = 0
  for (const entry of entries) {
    const match = entry.match(regex)
    if (!match) {
      continue
    }

    const parsed = Number.parseInt(match[1], 10)
    if (!Number.isNaN(parsed) && parsed > maxIndex) {
      maxIndex = parsed
    }
  }

  return String(maxIndex + 1).padStart(width, '0')
}

const main = () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === 'true') {
    process.stdout.write(`${usage}\n`)
    return
  }

  const triggerSlug = slugify(options.name)
  if (!triggerSlug) {
    throw new Error('Missing required --name <trigger-name>')
  }

  if (!options.table) {
    throw new Error('Missing required --table <table>')
  }

  const triggerIdentifier = `trg_${toSnake(triggerSlug)}`
  const functionIdentifier = `${toSnake(triggerSlug)}_fn`
  const tableIdentifier = options.table.trim().toLowerCase()
  const timing = options.timing.trim().toUpperCase()
  const level = options.level.trim().toUpperCase()
  const eventTokens = options.events
    .split(',')
    .map((event) => event.trim().toUpperCase())
    .filter(Boolean)

  ensureIdentifier(triggerIdentifier, 'trigger name')
  ensureIdentifier(functionIdentifier, 'function name')
  ensureQualifiedTable(tableIdentifier)

  const validTimings = new Set(['BEFORE', 'AFTER'])
  const validLevels = new Set(['ROW', 'STATEMENT'])
  const validEvents = new Set(['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])

  if (!validTimings.has(timing)) {
    throw new Error(`Invalid --timing value: ${timing}. Allowed: BEFORE, AFTER`)
  }

  if (!validLevels.has(level)) {
    throw new Error(`Invalid --level value: ${level}. Allowed: ROW, STATEMENT`)
  }

  if (eventTokens.length === 0) {
    throw new Error('At least one --events token is required (INSERT,UPDATE,DELETE,TRUNCATE)')
  }

  for (const eventToken of eventTokens) {
    if (!validEvents.has(eventToken)) {
      throw new Error(`Invalid event token: ${eventToken}. Allowed: INSERT, UPDATE, DELETE, TRUNCATE`)
    }
  }

  const repoRoot = process.cwd()
  const migrationsDir = resolve(repoRoot, 'packages/db/drizzle/migrations')
  const pgtapDir = resolve(repoRoot, 'packages/db/pgtap')

  if (!existsSync(migrationsDir)) {
    throw new Error(`Missing migrations directory: ${migrationsDir}`)
  }

  if (!existsSync(pgtapDir)) {
    mkdirSync(pgtapDir, { recursive: true })
  }

  const migrationPrefix = getNextIndex(readdirSync(migrationsDir), /^(\d{4})_.+\.sql$/u, 4)
  const pgtapPrefix = getNextIndex(readdirSync(pgtapDir), /^(\d{3})_.+\.pgtap\.sql$/u, 3)

  const migrationFileName = `${migrationPrefix}_${triggerSlug.replace(/-/gu, '_')}.sql`
  const pgtapFileName = `${pgtapPrefix}_${triggerSlug.replace(/-/gu, '_')}.pgtap.sql`

  const migrationPath = resolve(migrationsDir, migrationFileName)
  const pgtapPath = resolve(pgtapDir, pgtapFileName)

  if (existsSync(migrationPath)) {
    throw new Error(`Migration already exists: ${migrationPath}`)
  }

  if (existsSync(pgtapPath)) {
    throw new Error(`pgTAP suite already exists: ${pgtapPath}`)
  }

  const eventsSql = eventTokens.join(' OR ')
  const transitionRow = level === 'ROW' ? '  RETURN NEW;' : ''

  const migrationSql = [
    `CREATE OR REPLACE FUNCTION ${functionIdentifier}()`,
    'RETURNS trigger',
    'LANGUAGE plpgsql',
    'AS $$',
    'BEGIN',
    '  -- TODO: implement trigger behavior.',
    transitionRow,
    'END;',
    '$$;',
    '',
    `DROP TRIGGER IF EXISTS ${triggerIdentifier} ON ${tableIdentifier};`,
    '',
    `CREATE TRIGGER ${triggerIdentifier}`,
    `${timing} ${eventsSql} ON ${tableIdentifier}`,
    `FOR EACH ${level}`,
    `EXECUTE FUNCTION ${functionIdentifier}();`,
    ''
  ].join('\n')

  const pgtapSql = [
    'BEGIN;',
    '',
    '-- Trigger coverage marker:',
    `-- ${triggerIdentifier}`,
    '',
    'SELECT plan(1);',
    '',
    `SELECT fail('TODO: replace scaffold assertion with concrete pgTAP checks for ${triggerIdentifier}');`,
    '',
    'SELECT * FROM finish();',
    '',
    'ROLLBACK;',
    ''
  ].join('\n')

  writeFileSync(migrationPath, migrationSql, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(pgtapPath, pgtapSql, { encoding: 'utf8', flag: 'wx' })

  process.stdout.write(`Created migration: packages/db/drizzle/migrations/${migrationFileName}\n`)
  process.stdout.write(`Created pgTAP suite: packages/db/pgtap/${pgtapFileName}\n\n`)
  process.stdout.write('Next steps:\n')
  process.stdout.write('1. Implement trigger function body in generated migration file.\n')
  process.stdout.write('2. Replace scaffold `fail(...)` in generated pgTAP file with real assertions.\n')
  process.stdout.write('3. Run `pnpm db:migrate` and `pnpm test:db:pgtap`.\n')
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n\n${usage}\n`)
  process.exit(1)
}
