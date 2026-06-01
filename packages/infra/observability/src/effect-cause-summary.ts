import type { LogContext } from '@tx-agent-kit/logging'

// Shared Effect-cause summarization used by BOTH the API request boundary and
// the worker activity boundary, so error→log→Sentry context is identical across
// services. The only app-specific input is the set of "expected" error tags
// (4xx/business failures that should NOT be reported as faults) — passed into
// shouldLogEffectCause by each app.

const MAX_LOG_FIELD_LENGTH = 2000
const MAX_CAUSE_DEPTH = 8

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

const getStringField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? truncateLogField(value) : undefined
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

export const summarizeCause = (
  cause: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): CauseSummary | undefined => {
  if (cause === undefined || depth > MAX_CAUSE_DEPTH) {
    return undefined
  }

  if (cause instanceof Error) {
    if (seen.has(cause)) {
      return { type: 'CircularError', message: '[Circular]' }
    }
    seen.add(cause)

    const errorWithCause = cause as Error & { cause?: unknown }
    const nested = [summarizeCause(errorWithCause.cause, seen, depth + 1)]
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
      .map((candidate) => summarizeCause(candidate, seen, depth + 1))
      .filter((summary): summary is CauseSummary => summary !== undefined)
    const tag = getStringField(cause, '_tag') ?? getStringField(cause, '_id') ?? getStringField(cause, 'name')
    const code = getStringField(cause, 'code')

    return {
      type: tag ?? inferCauseType(cause),
      tag,
      code,
      message: getStringField(cause, 'message'),
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

export const toFlattenedCauseChain = (cause: unknown): ReadonlyArray<FlattenedCauseSummary> =>
  flattenCauseSummary(summarizeCause(cause)).map((item) => ({
    type: item.type,
    tag: item.tag,
    code: item.code,
    message: item.message
  }))

/**
 * True when a cause chain represents a genuine server fault worth logging at
 * error level + capturing to Sentry (vs an expected client/business failure).
 *
 * `expectedErrorTags` is the app-specific set of error tags that are NOT faults
 * (API: its HTTP error tags; worker: e.g. retryable publish failures). Anything
 * else — a `Die`, an `INTERNAL_ERROR`, an untagged error with a message, or a
 * tag outside the expected/structural/platform sets — is reportable.
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
  const root = chain.at(-1)

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
 * `DatabaseError`, a `ParseError`, an `HttpApiDecodeError` — all of which carry
 * a meaningful message and stack), so the reported issue points at the actual
 * code path instead of a freshly-allocated boundary `Error`. When the cause is
 * pure Effect data (a `Cause.fail` of a plain object with no JS `Error`), it
 * synthesizes an `Error` whose `name`/`message` come from the root of the cause
 * chain and whose `stack` is the supplied `Cause.pretty` rendering — i.e. the
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
  cause: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): Error | null => {
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
