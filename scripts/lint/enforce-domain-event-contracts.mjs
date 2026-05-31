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
    .map((segment) =>
      segment.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
    )
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

// ─── Rule 4: Event Payload Field Parity ─────────────────────────────
//
// For every domain event type the script now compares the field SETS of
// the TypeScript interface (in core/.../domain/*-events.ts) and the
// effect-Schema struct (in temporal-client/.../*.ts) and refuses to ship
// when they disagree. Catches the entire class of "added a field on one
// side but forgot the other" drift bugs that the existence checks above
// can't see.
//
// This is intentionally a field-NAME comparison only — type compatibility
// (string vs number, optional vs required) is delegated to TypeScript and
// to runtime Schema decode at the API boundary. The structural lint just
// has to guarantee that every name on one side is present on the other.

/**
 * Brace-balanced extraction: given a source string and an opening-brace
 * index, return the substring between that brace and its matching close.
 */
const extractBalancedBlock = (source, openBraceIndex) => {
  if (source[openBraceIndex] !== '{') {
    return null
  }
  let depth = 1
  let i = openBraceIndex + 1
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  if (depth !== 0) {
    return null
  }
  return source.slice(openBraceIndex + 1, i - 1)
}

/**
 * Strip line + block comments from a source slice so the field-key regex
 * never matches a documentation example.
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * Extract the field-name set from a `export interface FooEventPayload {
 * readonly foo: ...; bar: ...; }` block. Returns null if the interface
 * isn't found in the supplied source.
 */
const extractInterfaceFields = (source, interfaceName) => {
  const headerRegex = new RegExp(
    `export\\s+interface\\s+${interfaceName}\\b[^{]*\\{`
  )
  const match = headerRegex.exec(source)
  if (!match) {
    return null
  }
  const openBraceIndex = match.index + match[0].length - 1
  const body = extractBalancedBlock(source, openBraceIndex)
  if (body === null) {
    return null
  }
  const cleaned = stripComments(body)
  // Keys are `readonly? identifier:` or `identifier?:`. Reject lines
  // that look like nested types or parenthesized signatures.
  const fields = new Set()
  const fieldRegex = /(?:^|[\n;])\s*(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/g
  let fieldMatch
  while ((fieldMatch = fieldRegex.exec(cleaned)) !== null) {
    fields.add(fieldMatch[1])
  }
  return fields
}

/**
 * Extract the field-name set from a `export const FooSchema = Schema.Struct({...})`
 * block. Returns null if the schema isn't found.
 */
const extractSchemaFields = (source, schemaName) => {
  const headerRegex = new RegExp(
    `export\\s+const\\s+${schemaName}\\s*=\\s*Schema\\.Struct\\s*\\(\\s*\\{`
  )
  const match = headerRegex.exec(source)
  if (!match) {
    return null
  }
  const openBraceIndex = match.index + match[0].length - 1
  const body = extractBalancedBlock(source, openBraceIndex)
  if (body === null) {
    return null
  }
  const cleaned = stripComments(body)
  const fields = new Set()
  // Top-level keys only — skip nested struct keys by tracking brace depth.
  let depth = 0
  let lineStart = 0
  const lines = cleaned.split('\n')
  for (const line of lines) {
    if (depth === 0) {
      // Opening of a new key; match `keyName:` at the start of the
      // trimmed line. The key may be quoted (`'foo':`) or bare (`foo:`).
      const keyMatch = line.match(/^\s*(?:'([A-Za-z_$][A-Za-z0-9_$]*)'|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/)
      if (keyMatch) {
        fields.add(keyMatch[1] ?? keyMatch[2])
      }
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth++
      else if (ch === '}' || ch === ')' || ch === ']') depth--
    }
    lineStart += line.length + 1
  }
  void lineStart
  return fields
}

const setDiff = (a, b) => {
  const out = []
  for (const value of a) {
    if (!b.has(value)) {
      out.push(value)
    }
  }
  return out.sort()
}

for (const eventType of domainEventTypes) {
  const [aggregateName] = eventType.split('.')
  const interfaceName = toPascalCase(eventType) + 'EventPayload'
  const schemaName = interfaceName + 'Schema'

  // Find the TS interface
  const domainDir = resolve(repoRoot, `packages/core/src/domains/${aggregateName}/domain`)
  let interfaceFields = null
  if (existsSync(domainDir)) {
    const eventFiles = listFilesRecursively(domainDir).filter((f) => f.endsWith('-events.ts'))
    for (const filePath of eventFiles) {
      const fields = extractInterfaceFields(readUtf8(filePath), interfaceName)
      if (fields !== null) {
        interfaceFields = fields
        break
      }
    }
  }

  // Find the effect-Schema struct
  let schemaFields = null
  for (const filePath of temporalTypeFiles) {
    const fields = extractSchemaFields(readUtf8(filePath), schemaName)
    if (fields !== null) {
      schemaFields = fields
      break
    }
  }

  // If either side is missing the upstream existence checks will already
  // have failed — skip the parity check to avoid noise.
  if (interfaceFields === null || schemaFields === null) {
    continue
  }

  const onlyInInterface = setDiff(interfaceFields, schemaFields)
  const onlyInSchema = setDiff(schemaFields, interfaceFields)

  if (onlyInInterface.length > 0 || onlyInSchema.length > 0) {
    const lines = [
      `Event payload field drift for '${eventType}':`,
      `  TypeScript interface \`${interfaceName}\` and effect-Schema \`${schemaName}\` have different fields.`
    ]
    if (onlyInInterface.length > 0) {
      lines.push(`    Only in TS interface: ${onlyInInterface.map((f) => `\`${f}\``).join(', ')}`)
    }
    if (onlyInSchema.length > 0) {
      lines.push(`    Only in effect-Schema: ${onlyInSchema.map((f) => `\`${f}\``).join(', ')}`)
    }
    lines.push(
      `  Update both \`packages/core/src/domains/${aggregateName}/domain/*-events.ts\` and \`packages/temporal-client/src/types/*\` so the field sets match.`
    )
    fail(lines.join('\n'))
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
// The event→workflow dispatch table now lives in `dispatch/resolve-dispatch.ts`
// (the worker-owned event-driven dispatcher), not in a Temporal workflow, so the
// `dispatch/` dir is scanned alongside `workflows*.ts` for handler-case coverage.
const workerSrcDir = resolve(repoRoot, 'apps/worker/src')
const workflowFiles = existsSync(workerSrcDir)
  ? listFilesRecursively(workerSrcDir).filter(
      (f) => {
        const name = f.split('/').pop() ?? ''
        const inDispatchDir = f.includes('/apps/worker/src/dispatch/')
        const isHandlerFile =
          (name.startsWith('workflows') || (inDispatchDir && name.startsWith('resolve-dispatch')))
          && name.endsWith('.ts')
          && !name.includes('.test.')
        return isHandlerFile
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

const retentionSchemaPath = resolve(
  repoRoot,
  'packages/infra/db/schemas/system-settings/reconcile_retention_settings.sql'
)
const retentionSettingsContent = existsSync(retentionSchemaPath)
  ? readUtf8(retentionSchemaPath)
  : ''

if (retentionTableNames.length > 0 && !retentionSettingsContent) {
  fail(
    'Missing `packages/infra/db/schemas/system-settings/reconcile_retention_settings.sql`. Generate desired-state schemas so retention defaults are reconciled from the current policy.'
  )
} else {
  for (const tableName of retentionTableNames) {
    if (!retentionSettingsContent.includes(`"${tableName}"`)) {
      fail(
        `Table '${tableName}' is in retentionTableNames but missing from the generated retention_settings reconcile schema.`
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

// ─── Rule 13: Exhaustive switch default in workflow dispatchers ──────
// The event dispatcher switch must include a default: case that handles
// unknown event types. Without it, new types silently pass through.
for (const wfPath of workflowFiles) {
  const wfSource = readUtf8(wfPath)
  const relativePath = toPosix(relative(repoRoot, wfPath))

  // Find switch blocks that dispatch on event.eventType
  const switchMatches = [...wfSource.matchAll(/switch\s*\(\s*event\.eventType\s*\)/g)]
  for (const switchMatch of switchMatches) {
    // Extract the switch block using brace balancing
    let depth = 0
    let i = switchMatch.index + switchMatch[0].length
    // Skip to opening brace
    while (i < wfSource.length && wfSource[i] !== '{') i++
    if (i >= wfSource.length) continue
    depth = 1
    i++
    const blockStart = i
    while (i < wfSource.length && depth > 0) {
      if (wfSource[i] === '{') depth++
      else if (wfSource[i] === '}') depth--
      i++
    }
    const switchBlock = wfSource.slice(blockStart, i - 1)

    if (!/\bdefault\s*:/u.test(switchBlock)) {
      fail(
        `Event dispatcher switch in \`${relativePath}\` is missing a \`default:\` case. Add a default handler that marks unknown event types as failed.`
      )
    }
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
