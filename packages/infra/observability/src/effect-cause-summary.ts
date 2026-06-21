import type { LogContext } from '@tx-agent-kit/logging'
import { FiberFailureCauseId } from 'effect/Runtime'

// Shared Effect-cause summarization used by BOTH the API request boundary and
// the worker activity boundary, so error->log->Sentry context is identical across
// services. The only app-specific input is the set of "expected" error tags
// (4xx/business failures that should NOT be reported as faults) passed into
// shouldLogEffectCause by each app.

const MAX_LOG_FIELD_LENGTH = 2000
const MAX_CAUSE_DEPTH = 8
const MAX_SERIALIZED_OBJECT_DEPTH = 4

export interface CauseSummary {
  readonly type: string
  readonly tag?: string
  readonly code?: string
  readonly message?: string
  readonly stack?: string
  readonly nested?: ReadonlyArray<CauseSummary>
}

export interface FlattenedCauseSummary {
  readonly type: string
  readonly tag?: string
  readonly code?: string
  readonly message?: string
}

const truncateLogField = (value: string): string =>
  value.length <= MAX_LOG_FIELD_LENGTH
    ? value
    : `${value.slice(0, MAX_LOG_FIELD_LENGTH)}...`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// `Effect.runPromise` (used by every worker activity's `runEffect`) rejects with
// a `(FiberFailure) Error` whose standard `.message`/`.name` are the squashed
// boundary text and whose REAL cause chain is stashed under the
// `FiberFailureCauseId` symbol, NOT the JS-standard `.cause`. Without unwrapping,
// the chain flattens to that useless wrapper and telemetry loses the actual root
// (e.g. a DbError -> ParseError). Peel the symbol so the existing cause
// traversal reaches the underlying Effect Cause.
const unwrapFiberFailureCause = (cause: unknown): unknown => {
  if (
    (isRecord(cause) || cause instanceof Error) &&
    FiberFailureCauseId in (cause as object)
  ) {
    return (cause as Record<symbol, unknown>)[FiberFailureCauseId]
  }
  return cause
}

// A JWT-claim verification failure carries a `payload` object with the decoded
// claims (email/sub/sid PII). Detect that shape so the `payload` key can be
// redacted while still surfacing the rest of the metadata in logs.
const isJwtClaimMetadataRecord = (record: Record<string, unknown>): boolean =>
  typeof record.claim === 'string' &&
  typeof record.reason === 'string' &&
  isRecord(record.payload)

const getStringField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? truncateLogField(value) : undefined
}

const sensitiveKeyPattern = /(?:authorization|client_secret|cookie|password|refresh_token|access_token|id_token|token|secret|code_verifier)/iu

const sanitizeValueForLog = (
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown => {
  if (depth > MAX_SERIALIZED_OBJECT_DEPTH) {
    return '[MaxDepth]'
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValueForLog(item, seen, depth + 1))
  }

  if (!isRecord(value)) {
    return typeof value === 'bigint' ? value.toString() : value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  const isJwtClaimMetadata = isJwtClaimMetadataRecord(value)
  const entries = Object.entries(value).map(([key, entryValue]) => [
    key,
    sensitiveKeyPattern.test(key) || (isJwtClaimMetadata && key === 'payload')
      ? '[REDACTED]'
      : sanitizeValueForLog(entryValue, seen, depth + 1)
  ])
  return Object.fromEntries(entries)
}

export const describeCauseForLog = (cause: unknown): string => {
  if (cause instanceof Error) {
    const codedCause = cause as Error & { code?: unknown; cause?: unknown }
    const code = typeof codedCause.code === 'string'
      ? ` (${codedCause.code})`
      : ''
    const nestedCause = codedCause.cause
    const nested = nestedCause === undefined ? '' : `; cause=${describeCauseForLog(nestedCause)}`
    return truncateLogField(`${cause.message}${code}${nested}`)
  }

  if (isRecord(cause) || Array.isArray(cause)) {
    try {
      return truncateLogField(JSON.stringify(sanitizeValueForLog(cause, new WeakSet(), 0)))
    } catch {
      return '[Unserializable object]'
    }
  }

  return truncateLogField(String(cause))
}

const inferCauseType = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.name
  }

  if (Array.isArray(cause)) {
    return 'Array'
  }

  if (cause === null) {
    return 'null'
  }

  return typeof cause
}

const nestedCauseCandidateKeys = [
  'cause',
  'error',
  'failure',
  'defect',
  'errors',
  'left',
  'right'
] as const

const getStructuredObjectMessage = (record: Record<string, unknown>): string | undefined => {
  const hasSemanticCauseFields = [
    '_tag',
    '_id',
    'name',
    'code',
    'message'
  ].some((key) => record[key] !== undefined && record[key] !== null)

  if (hasSemanticCauseFields || Object.keys(record).length === 0) {
    return undefined
  }

  return describeCauseForLog(record)
}

const getNestedCauseCandidates = (record: Record<string, unknown>): ReadonlyArray<unknown> => {
  const candidates: unknown[] = []

  for (const key of nestedCauseCandidateKeys) {
    const value = record[key]
    if (value === undefined || value === null) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        candidates.push(item)
      }
      continue
    }

    candidates.push(value)
  }

  return candidates
}

const hasActionableSummaryDetail = (summary: CauseSummary): boolean =>
  summary.tag !== undefined ||
  summary.code !== undefined ||
  summary.message !== undefined ||
  (summary.nested?.length ?? 0) > 0 ||
  summary.type !== 'object'

const summarizeNestedCause = (
  cause: unknown,
  seen: WeakSet<object>,
  depth: number
): CauseSummary | undefined => {
  const summary = summarizeCause(cause, seen, depth)
  return summary && hasActionableSummaryDetail(summary) ? summary : undefined
}

export const summarizeCause = (
  rawCause: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): CauseSummary | undefined => {
  const cause = unwrapFiberFailureCause(rawCause)
  if (cause === undefined || depth > MAX_CAUSE_DEPTH) {
    return undefined
  }

  if (cause instanceof Error) {
    if (seen.has(cause)) {
      return { type: 'CircularError', message: '[Circular]' }
    }
    seen.add(cause)

    const errorWithCause = cause as Error & { cause?: unknown }
    const nested = [summarizeNestedCause(errorWithCause.cause, seen, depth + 1)]
      .filter((summary): summary is CauseSummary => summary !== undefined)

    return {
      type: cause.name,
      tag: cause.name,
      message: truncateLogField(cause.message),
      stack: cause.stack ? truncateLogField(cause.stack) : undefined,
      nested
    }
  }

  if (isRecord(cause)) {
    if (seen.has(cause)) {
      return { type: 'CircularObject', message: '[Circular]' }
    }
    seen.add(cause)

    const nested = getNestedCauseCandidates(cause)
      .map((candidate) => summarizeNestedCause(candidate, seen, depth + 1))
      .filter((summary): summary is CauseSummary => summary !== undefined)
    const tag = getStringField(cause, '_tag') ?? getStringField(cause, '_id') ?? getStringField(cause, 'name')
    const code = getStringField(cause, 'code')

    return {
      type: tag ?? inferCauseType(cause),
      tag,
      code,
      message: getStringField(cause, 'message') ?? getStructuredObjectMessage(cause),
      nested
    }
  }

  if (typeof cause === 'string') {
    return { type: 'string', message: truncateLogField(cause) }
  }

  if (typeof cause === 'number' || typeof cause === 'boolean' || typeof cause === 'bigint') {
    return { type: typeof cause, message: String(cause) }
  }

  return undefined
}

export const flattenCauseSummary = (
  summary: CauseSummary | undefined
): ReadonlyArray<CauseSummary> => {
  const summaries: CauseSummary[] = []

  const visit = (current: CauseSummary | undefined): void => {
    if (!current) {
      return
    }

    summaries.push(current)
    for (const nested of current.nested ?? []) {
      visit(nested)
    }
  }

  visit(summary)
  return summaries
}

// Generic Effect Cause structural tags + platform tags that are never faults.
const structuralCauseTags = new Set([
  'Fail',
  'Die',
  'Parallel',
  'Sequential',
  'Interrupt',
  'Empty'
])

const expectedPlatformCauseTags = new Set([
  'RouteNotFound'
])

const isPlainObjectMetadataSummary = (item: FlattenedCauseSummary): boolean => {
  if (
    item.tag !== undefined ||
    item.code !== undefined ||
    item.message === undefined ||
    (item.type !== 'object' && item.type !== 'Array')
  ) {
    return false
  }

  const trimmedMessage = item.message.trimStart()
  return trimmedMessage.startsWith('{') || trimmedMessage.startsWith('[')
}

export const toFlattenedCauseChain = (cause: unknown): ReadonlyArray<FlattenedCauseSummary> =>
  flattenCauseSummary(summarizeCause(cause)).map((item) => ({
    type: item.type,
    tag: item.tag,
    code: item.code,
    message: item.message
  }))

/**
 * `HttpApiDecodeError` is @effect/platform's REQUEST-decoding failure (a bad
 * path/query/body shape) — a client 4xx, NOT a server fault. Returns the first
 * offending field name when the cause is such a decode error (or `'unknown'` when
 * the field can't be parsed from the rendered issue tree), else `null` when the
 * cause is not a request-decode error. The field is parsed from the issue path
 * marker (e.g. `["organizationId"]`) the decoder renders into the message.
 */
export const extractRequestDecodeField = (cause: unknown): string | null => {
  const decodeItem = toFlattenedCauseChain(cause).find(
    (item) => item.tag === 'HttpApiDecodeError'
  )
  if (decodeItem === undefined) {
    return null
  }

  const matchedField = decodeItem.message?.match(/\["([^"]+)"\]/u)?.[1]
  return matchedField ?? 'unknown'
}

/**
 * True when a cause chain represents a genuine server fault worth logging at
 * error level + capturing to Sentry (vs an expected client/business failure).
 *
 * `expectedErrorTags` is the app-specific set of error tags that are NOT faults
 * (API: its HTTP error tags; worker: e.g. retryable publish failures). Anything
 * else, a `Die`, an `INTERNAL_ERROR`, an untagged error with a message, or a
 * tag outside the expected/structural/platform sets, is reportable.
 */
export const shouldLogEffectCause = (
  cause: unknown,
  expectedErrorTags: ReadonlySet<string> = new Set<string>()
): boolean => {
  const chain = toFlattenedCauseChain(cause)

  if (chain.length === 0) {
    return false
  }

  return chain.some((item) => {
    if (item.tag === 'Die' || item.tag === 'InternalError' || item.code === 'INTERNAL_ERROR') {
      return true
    }

    if (chain.length > 1 && isPlainObjectMetadataSummary(item)) {
      return false
    }

    if (item.tag === undefined) {
      return item.message !== undefined
    }

    return !expectedErrorTags.has(item.tag) &&
      !expectedPlatformCauseTags.has(item.tag) &&
      !structuralCauseTags.has(item.tag)
  })
}

export const causeLogContext = (cause: unknown): LogContext => {
  const chain = toFlattenedCauseChain(cause)
  const first = chain[0]
  const root = chain.length > 1
    ? [...chain].reverse().find((item) => !isPlainObjectMetadataSummary(item)) ?? chain.at(-1)
    : chain.at(-1)

  return {
    causeType: first?.type,
    causeTag: first?.tag,
    causeCode: first?.code,
    causeMessage: first?.message,
    rootCauseType: root?.type,
    rootCauseTag: root?.tag,
    rootCauseCode: root?.code,
    rootCauseMessage: root?.message,
    causeChain: chain
  }
}

/**
 * Produce the `Error` to hand to Sentry for an Effect cause.
 *
 * Prefers the deepest real JS `Error` in the cause tree (e.g. a pg
 * `DatabaseError`, a `ParseError`, an `HttpApiDecodeError`, all of which carry
 * a meaningful message and stack), so the reported issue points at the actual
 * code path instead of a freshly-allocated boundary `Error`. When the cause is
 * pure Effect data (a `Cause.fail` of a plain object with no JS `Error`), it
 * synthesizes an `Error` whose `name`/`message` come from the root of the cause
 * chain and whose `stack` is the supplied `Cause.pretty` rendering, i.e. the
 * logical Effect span trace rather than fiber internals.
 */
export const buildCauseReportError = (
  cause: unknown,
  options: { readonly fallbackMessage: string; readonly prettyStack?: string }
): Error => {
  const rootError = findRootCauseError(cause)
  if (rootError) {
    return rootError
  }

  const root = toFlattenedCauseChain(cause).at(-1)
  const message = root?.message ?? root?.tag ?? options.fallbackMessage
  const synthetic = new Error(message)
  if (root?.tag) {
    synthetic.name = root.tag
  }
  if (options.prettyStack) {
    synthetic.stack = `${synthetic.name}: ${message}\n${options.prettyStack}`
  }
  return synthetic
}

export const findRootCauseError = (
  rawCause: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): Error | null => {
  const cause = unwrapFiberFailureCause(rawCause)
  if (cause === undefined || cause === null || depth > MAX_CAUSE_DEPTH) {
    return null
  }

  if (cause instanceof Error) {
    if (seen.has(cause)) {
      return cause
    }
    seen.add(cause)

    const nested = findRootCauseError(
      (cause as Error & { cause?: unknown }).cause,
      seen,
      depth + 1
    )
    return nested ?? cause
  }

  if (!isRecord(cause)) {
    return null
  }

  if (seen.has(cause)) {
    return null
  }
  seen.add(cause)

  let latest: Error | null = null
  for (const candidate of getNestedCauseCandidates(cause)) {
    latest = findRootCauseError(candidate, seen, depth + 1) ?? latest
  }
  return latest
}
