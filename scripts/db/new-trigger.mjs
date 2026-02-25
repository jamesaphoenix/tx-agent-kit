#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const usage = `
Usage:
  pnpm db:trigger:new --name <trigger-name> --table <table> [--timing BEFORE|AFTER] [--events INSERT,UPDATE] [--level ROW|STATEMENT]
  pnpm tx db:trigger:new --name <trigger-name> --table <table> [--timing BEFORE|AFTER] [--events INSERT,UPDATE] [--level ROW|STATEMENT]

Examples:
  pnpm db:trigger:new --name normalize-project-email --table invitations --timing BEFORE --events INSERT,UPDATE
  pnpm db:trigger:new --name workspace-billing-rollup --table tasks --timing AFTER --events INSERT,UPDATE,DELETE
`.trim()

const valueOptionFlags = new Set(['--name', '--table', '--timing', '--events', '--level'])

const parseInlineOption = (arg) => {
  if (!arg.startsWith('--') || !arg.includes('=')) {
    return null
  }

  const separatorIndex = arg.indexOf('=')
  return {
    flag: arg.slice(0, separatorIndex),
    value: arg.slice(separatorIndex + 1)
  }
}

const parseArgs = (argv) => {
  const options = {
    help: false,
    name: '',
    table: '',
    timing: 'BEFORE',
    events: 'INSERT',
    level: 'ROW'
  }

  const seenOptions = new Set()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      break
    }

    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const inlineOption = parseInlineOption(arg)
    if (inlineOption) {
      const { flag, value } = inlineOption
      if (!valueOptionFlags.has(flag)) {
        throw new Error(`Unknown option: ${flag}`)
      }

      if (seenOptions.has(flag)) {
        throw new Error(`Duplicate option: ${flag}`)
      }

      if (!value.trim()) {
        throw new Error(`Missing value for ${flag}`)
      }

      options[flag.slice(2)] = value
      seenOptions.add(flag)
      continue
    }

    if (!valueOptionFlags.has(arg)) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (seenOptions.has(arg)) {
      throw new Error(`Duplicate option: ${arg}`)
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('-')) {
      throw new Error(`Missing value for ${arg}`)
    }

    options[arg.slice(2)] = next
    seenOptions.add(arg)
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

const ensureIdentifierLength = (value, label) => {
  if (value.length > 63) {
    throw new Error(`${label} exceeds PostgreSQL identifier length limit (63): ${value}`)
  }
}

const ensureQualifiedTable = (value) => {
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/u.test(value)) {
    throw new Error(`table must be "<table>" or "<schema>.<table>" with snake_case identifiers (received: ${value})`)
  }

  const [firstSegment, secondSegment] = value.split('.')
  if (!secondSegment) {
    ensureIdentifierLength(firstSegment, 'table name')
    return
  }

  ensureIdentifierLength(firstSegment, 'schema name')
  ensureIdentifierLength(secondSegment, 'table name')
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

const findRepoRoot = (startDir) => {
  let current = resolve(startDir)

  while (true) {
    const packageJsonPath = resolve(current, 'package.json')
    const migrationsDir = resolve(current, 'packages/infra/db/drizzle/migrations')

    if (existsSync(packageJsonPath) && existsSync(migrationsDir)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        if (packageJson && packageJson.name === 'tx-agent-kit') {
          return current
        }
      } catch {
        // Ignore parse errors and continue searching upwards.
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

const buildReturnBlock = (level) => {
  if (level === 'STATEMENT') {
    return ['  RETURN NULL;']
  }

  return [
    "  IF TG_OP = 'DELETE' THEN",
    '    RETURN OLD;',
    '  END IF;',
    '',
    '  RETURN NEW;'
  ]
}

const writeExclusiveFile = (path, content, label) => {
  try {
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    const errno = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (errno === 'EEXIST') {
      throw new Error(`${label} already exists (possibly created concurrently): ${path}`)
    }
    throw error
  }
}

export const runNewTrigger = (argv, cwd = process.cwd()) => {
  const options = parseArgs(argv)
  if (options.help) {
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
  const eventTokens = [
    ...new Set(
      options.events
        .split(',')
        .map((event) => event.trim().toUpperCase())
        .filter(Boolean)
    )
  ]

  ensureIdentifier(triggerIdentifier, 'trigger name')
  ensureIdentifier(functionIdentifier, 'function name')
  ensureIdentifierLength(triggerIdentifier, 'trigger name')
  ensureIdentifierLength(functionIdentifier, 'function name')
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

  if (level === 'ROW' && eventTokens.includes('TRUNCATE')) {
    throw new Error('TRUNCATE triggers must use --level STATEMENT')
  }

  const repoRoot = findRepoRoot(cwd)
  const migrationsDir = resolve(repoRoot, 'packages/infra/db/drizzle/migrations')
  const pgtapDir = resolve(repoRoot, 'packages/infra/db/pgtap')

  if (!existsSync(migrationsDir)) {
    throw new Error(`Missing migrations directory: ${migrationsDir}`)
  }

  if (!existsSync(pgtapDir)) {
    mkdirSync(pgtapDir, { recursive: true })
  }

  const migrationEntries = readdirSync(migrationsDir)
  const pgtapEntries = readdirSync(pgtapDir)
  const fileStem = triggerSlug.replace(/-/gu, '_')

  if (migrationEntries.some((entry) => entry.endsWith(`_${fileStem}.sql`))) {
    throw new Error(`Migration for trigger already exists: ${fileStem}`)
  }

  if (pgtapEntries.some((entry) => entry.endsWith(`_${fileStem}.pgtap.sql`))) {
    throw new Error(`pgTAP suite for trigger already exists: ${fileStem}`)
  }

  const eventsSql = eventTokens.join(' OR ')
  const returnBlock = buildReturnBlock(level)

  const migrationSql = [
    `CREATE OR REPLACE FUNCTION ${functionIdentifier}()`,
    'RETURNS trigger',
    'LANGUAGE plpgsql',
    'AS $$',
    'BEGIN',
    '  -- Implement trigger behavior.',
    ...returnBlock,
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
    `SELECT fail('Replace scaffold assertion with concrete pgTAP checks for ${triggerIdentifier}');`,
    '',
    'SELECT * FROM finish();',
    '',
    'ROLLBACK;',
    ''
  ].join('\n')

  const maxPrefixAllocationAttempts = 20
  let migrationFileName = ''
  let pgtapFileName = ''
  let wroteFiles = false
  let lastWriteError

  for (
    let allocationAttempt = 0;
    allocationAttempt < maxPrefixAllocationAttempts;
    allocationAttempt += 1
  ) {
    const migrationPrefix = getNextIndex(
      readdirSync(migrationsDir),
      /^(\d{4})_.+\.sql$/u,
      4
    )
    const pgtapPrefix = getNextIndex(
      readdirSync(pgtapDir),
      /^(\d{3})_.+\.pgtap\.sql$/u,
      3
    )

    migrationFileName = `${migrationPrefix}_${fileStem}.sql`
    pgtapFileName = `${pgtapPrefix}_${fileStem}.pgtap.sql`

    const migrationPath = resolve(migrationsDir, migrationFileName)
    const pgtapPath = resolve(pgtapDir, pgtapFileName)

    if (existsSync(migrationPath) || existsSync(pgtapPath)) {
      continue
    }

    try {
      writeExclusiveFile(migrationPath, migrationSql, 'Migration')
      writeExclusiveFile(pgtapPath, pgtapSql, 'pgTAP suite')
      wroteFiles = true
      break
    } catch (error) {
      rmSync(migrationPath, { force: true })
      lastWriteError = error
      continue
    }
  }

  if (!wroteFiles) {
    if (lastWriteError instanceof Error) {
      throw new Error(
        `Unable to allocate trigger scaffold files after ${maxPrefixAllocationAttempts} attempts: ${lastWriteError.message}`
      )
    }

    throw new Error(
      `Unable to allocate trigger scaffold files after ${maxPrefixAllocationAttempts} attempts.`
    )
  }

  process.stdout.write(`Created migration: packages/infra/db/drizzle/migrations/${migrationFileName}\n`)
  process.stdout.write(`Created pgTAP suite: packages/infra/db/pgtap/${pgtapFileName}\n\n`)
  process.stdout.write('Next steps:\n')
  process.stdout.write('1. Implement trigger function body in generated migration file.\n')
  process.stdout.write('2. Replace scaffold fail(...) in generated pgTAP file with real assertions.\n')
  process.stdout.write('3. Run `pnpm db:migrate` and `pnpm test:db:pgtap`.\n')
}

const main = () => {
  runNewTrigger(process.argv.slice(2))
}

const isDirectInvocation = () => {
  const scriptPath = process.argv[1]
  if (!scriptPath) {
    return false
  }

  return resolve(scriptPath) === fileURLToPath(import.meta.url)
}

if (isDirectInvocation()) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n\n${usage}\n`)
    process.exit(1)
  }
}
