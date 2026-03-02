#!/usr/bin/env node

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const errors = []

const toPosix = (value) => value.split(sep).join('/')
const fail = (message) => { errors.push(message) }
const readUtf8 = (path) => readFileSync(path, 'utf8')

const listFilesRecursively = (rootDir) => {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return []
  }

  const files = []
  const entries = readdirSync(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath))
      continue
    }

    files.push(fullPath)
  }

  return files
}

const toPascalCase = (value) =>
  value
    .split('.')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')

// ─── Read domainEventTypes from contracts ────────────────────────────
const contractsPath = resolve(repoRoot, 'packages/contracts/src/literals.ts')
if (!existsSync(contractsPath)) {
  fail('Missing `packages/contracts/src/literals.ts`.')
}

const contractsSource = existsSync(contractsPath) ? readUtf8(contractsPath) : ''
const domainEventTypesMatch = contractsSource.match(
  /export const domainEventTypes\s*=\s*\[([\s\S]*?)\]\s*as const/
)

const domainEventTypes = domainEventTypesMatch
  ? [...domainEventTypesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : []

if (domainEventTypes.length === 0) {
  fail('No event types found in `domainEventTypes` in `packages/contracts/src/literals.ts`.')
}

// ─── Rule 9: Event Type Naming Convention ───────────────────────────
const eventTypeRegex = /^[a-z][a-z_]*\.[a-z][a-z_]*$/
for (const eventType of domainEventTypes) {
  if (!eventTypeRegex.test(eventType)) {
    fail(
      `Event type '${eventType}' in domainEventTypes does not match the naming convention /^[a-z][a-z_]*\\.[a-z][a-z_]*$/ (lowercase, dot-separated, underscores allowed).`
    )
  }
}

// ─── Rule 1: Event Type Registry Enforcement ────────────────────────
// Only check event types that match the domain event naming convention (dot-separated).
// Auth audit event types (login_success, etc.) are a separate concept and don't contain dots.
const scanDirs = [
  resolve(repoRoot, 'packages/core/src'),
  resolve(repoRoot, 'apps/worker/src')
]

const eventTypePatterns = [
  /eventType:\s*'([^']+)'/g,
  /case\s+'([^']+)'/g,
  /eventType\s*===\s*'([^']+)'/g
]
const domainEventPattern = /^[a-z][a-z_]*\.[a-z][a-z_]*$/

for (const scanDir of scanDirs) {
  const files = listFilesRecursively(scanDir).filter(
    (f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.')
  )

  for (const filePath of files) {
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))

    for (const regex of eventTypePatterns) {
      for (const match of source.matchAll(regex)) {
        const eventType = match[1]
        if (domainEventPattern.test(eventType) && !domainEventTypes.includes(eventType)) {
          fail(
            `Unregistered event type '${eventType}' used in \`${relativePath}\`. Register it in \`domainEventTypes\` in \`packages/contracts/src/literals.ts\`.`
          )
        }
      }
    }
  }
}

// ─── Rule 2: Event Payload Interface Parity ─────────────────────────
for (const eventType of domainEventTypes) {
  const [aggregateName] = eventType.split('.')
  const pascalName = toPascalCase(eventType) + 'EventPayload'
  const domainDir = resolve(repoRoot, `packages/core/src/domains/${aggregateName}/domain`)

  if (!existsSync(domainDir)) {
    fail(
      `Missing domain directory \`packages/core/src/domains/${aggregateName}/domain\` for event type '${eventType}'.`
    )
    continue
  }

  const eventFiles = listFilesRecursively(domainDir).filter(
    (f) => f.endsWith('-events.ts')
  )

  let found = false
  for (const filePath of eventFiles) {
    const source = readUtf8(filePath)
    if (source.includes(`export interface ${pascalName}`)) {
      found = true
      break
    }
  }

  if (!found) {
    fail(
      `Missing \`export interface ${pascalName}\` for event type '${eventType}' in \`packages/core/src/domains/${aggregateName}/domain/*-events.ts\`.`
    )
  }
}

// ─── Rule 3: Event Payload Schema Parity ────────────────────────────
const temporalTypesDir = resolve(repoRoot, 'packages/temporal-client/src/types')
const temporalTypeFiles = existsSync(temporalTypesDir)
  ? listFilesRecursively(temporalTypesDir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  : []

for (const eventType of domainEventTypes) {
  const schemaName = toPascalCase(eventType) + 'EventPayloadSchema'
  const exportPattern = new RegExp(`export\\s+const\\s+${schemaName}\\b`)

  let found = false
  for (const filePath of temporalTypeFiles) {
    const source = readUtf8(filePath)
    if (exportPattern.test(source)) {
      found = true
      break
    }
  }

  if (!found) {
    fail(
      `Missing \`export const ${schemaName}\` in \`packages/temporal-client/src/types/\` for event type '${eventType}'.`
    )
  }
}

// ─── Rule 5: Transactional Event Write Enforcement ──────────────────
const repoDir = resolve(repoRoot, 'packages/infra/db/src/repositories')
const repoFiles = existsSync(repoDir)
  ? listFilesRecursively(repoDir).filter(
      (f) =>
        (f.endsWith('.ts') || f.endsWith('.tsx')) &&
        !f.includes('.test.') &&
        !f.endsWith('domain-events.ts')
    )
  : []

for (const filePath of repoFiles) {
  const source = readUtf8(filePath)
  const relativePath = toPosix(relative(repoRoot, filePath))

  if (!source.includes('domainEvents')) {
    continue
  }

  const insertMatches = [...source.matchAll(/\.insert\(domainEvents\)/g)]
  for (const match of insertMatches) {
    const precedingChunk = source.slice(Math.max(0, match.index - 3000), match.index)
    if (!precedingChunk.includes('.transaction(') && !precedingChunk.includes('trx')) {
      fail(
        `Domain event insert in \`${relativePath}\` appears outside a database transaction. Use \`db.transaction()\` to ensure atomicity.`
      )
    }
  }
}

// ─── Rule 6: Event Handler Completeness ─────────────────────────────
const workerSrcDir = resolve(repoRoot, 'apps/worker/src')
const workflowFiles = existsSync(workerSrcDir)
  ? listFilesRecursively(workerSrcDir).filter(
      (f) => {
        const name = f.split('/').pop() ?? ''
        return name.startsWith('workflows') && name.endsWith('.ts') && !name.includes('.test.')
      }
    )
  : []

const allCaseMatches = []
for (const wfPath of workflowFiles) {
  const wfSource = readUtf8(wfPath)
  allCaseMatches.push(...[...wfSource.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]))
}

for (const eventType of domainEventTypes) {
  if (!allCaseMatches.includes(eventType)) {
    fail(
      `Missing case '${eventType}' in the event dispatcher in \`apps/worker/src/workflows*.ts\`. Every registered event type must have a handler case.`
    )
  }
}

// ─── Rule 7: Idempotent Workflow ID Enforcement ─────────────────────
// Uses brace-balanced extraction to handle nested objects in startChild/executeChild options.
const extractCallBlocks = (source) => {
  const blocks = []
  const callRe = /(?:startChild|executeChild)\s*\(/g
  let m
  while ((m = callRe.exec(source)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') depth--
      i++
    }
    blocks.push(source.slice(m.index, i))
  }
  return blocks
}

const workflowsPath = resolve(repoRoot, 'apps/worker/src/workflows.ts')
if (existsSync(workflowsPath)) {
  const workflowsSource = readUtf8(workflowsPath)
  const startChildBlocks = extractCallBlocks(workflowsSource)

  for (const block of startChildBlocks) {
    const workflowIdMatch = block.match(/workflowId:\s*[`']([^`']*)[`']/)
    if (!workflowIdMatch) {
      fail(
        `\`startChild\`/\`executeChild\` call in \`apps/worker/src/workflows.ts\` is missing a \`workflowId\` property. Include a workflowId with \`event.id\` for idempotent dispatch.`
      )
      continue
    }

    const idValue = workflowIdMatch[1]
    if (!idValue.includes('event.id') && !idValue.includes('${event.id}')) {
      fail(
        `\`startChild\` call in \`apps/worker/src/workflows.ts\` has workflowId '${idValue}' that does not include \`event.id\`. Include the event ID for idempotent dispatch.`
      )
    }
  }
}

// ─── Rule 8: Ban `as` casts on event payloads in worker ─────────────
const workerPayloadFiles = existsSync(workerSrcDir)
  ? listFilesRecursively(workerSrcDir).filter(
      (f) => f.endsWith('.ts') && !f.includes('.test.')
    )
  : []

const payloadAsRegex = /\.payload\s+as\s+/g

for (const filePath of workerPayloadFiles) {
  if (!existsSync(filePath)) {
    continue
  }

  const source = readUtf8(filePath)
  const relativePath = toPosix(relative(repoRoot, filePath))

  for (const match of source.matchAll(payloadAsRegex)) {
    fail(
      `Type assertion on event payload ('${match[0].trim()}') in \`${relativePath}\`. Use Schema decode for event payload deserialization.`
    )
  }
}

// ─── Rule 11: Retention Settings Completeness ────────────────────────
const retentionTableNamesMatch = contractsSource.match(
  /export const retentionTableNames\s*=\s*\[([\s\S]*?)\]\s*as const/
)
const retentionTableNames = retentionTableNamesMatch
  ? [...retentionTableNamesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : []

const migrationDir = resolve(repoRoot, 'packages/infra/db/drizzle/migrations')
const migrationFiles = existsSync(migrationDir)
  ? readdirSync(migrationDir).filter((f) => f.endsWith('.sql'))
  : []

let retentionSettingsContent = ''
for (const mFile of migrationFiles) {
  const content = readUtf8(join(migrationDir, mFile))
  if (content.includes('retention_settings')) {
    retentionSettingsContent += content
  }
}

if (retentionTableNames.length > 0 && !retentionSettingsContent) {
  fail(
    'No migration file contains a `retention_settings` seed. Ensure the system_settings migration exists and seeds retention defaults.'
  )
} else {
  for (const tableName of retentionTableNames) {
    if (!retentionSettingsContent.includes(`"${tableName}"`)) {
      fail(
        `Table '${tableName}' is in retentionTableNames but missing from the retention_settings seed in migrations.`
      )
    }
  }
}

// ─── Rule 12: Domain event inserts use helper ────────────────────────
const rule12RepoDir = resolve(repoRoot, 'packages/infra/db/src/repositories')
const rule12RepoFiles = existsSync(rule12RepoDir)
  ? listFilesRecursively(rule12RepoDir).filter(
      (f) => f.endsWith('.ts') && !f.includes('.test.') && !f.endsWith('domain-events.ts')
    )
  : []

for (const filePath of rule12RepoFiles) {
  const source = readUtf8(filePath)

  if (!source.includes('domainEvents')) continue

  const relativePath = toPosix(relative(repoRoot, filePath))
  const inlineInsertPattern = /\.insert\(domainEvents\)\.values\(/g
  for (const _match of source.matchAll(inlineInsertPattern)) {
    fail(
      `Inline domain event insert in \`${relativePath}\`. Use \`insertDomainEventInTransaction(trx, ...)\` from \`domain-events.ts\` instead.`
    )
  }
}

// ─── Report ─────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('Domain event contract check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Domain event contract check passed.')
