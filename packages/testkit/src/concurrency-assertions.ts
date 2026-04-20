/**
 * Assertions for concurrency stress tests.
 *
 * The problem these helpers solve: when you run N parallel operations and
 * expect all of them to succeed, the naive assertion `expect(Either.isRight(o)).toBe(true)`
 * inside a loop gives you "expected false to be true" on failure — the actual
 * error is swallowed, and debugging a flake becomes a guessing game.
 *
 * These helpers collect every failure, group them by error shape, and throw a
 * single structured message so the first CI failure shows you exactly which
 * errors fired, how many, and the first instance in full.
 *
 * Usage:
 *
 *     import { expectAllRight } from '@tx-agent-kit/testkit'
 *     import { Either } from 'effect'
 *
 *     const outcomes = await Promise.all(ops)
 *     expectAllRight(outcomes, { context: 'releaseStaleReservations ×100' })
 *
 * Or for plain promises:
 *
 *     const results = await Promise.allSettled(ops)
 *     expectAllFulfilled(results, { context: 'bulk credit append' })
 */
import { Either } from 'effect'

export interface ConcurrencyAssertionOptions {
  /** Short description shown in the error prefix — e.g. the operation name. */
  readonly context: string
  /** Cap on distinct error shapes to report. Default: 5. */
  readonly maxErrorSamples?: number
}

interface ErrorShape {
  readonly key: string
  count: number
  readonly sample: unknown
}

const summarizeError = (err: unknown): string => {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`
  }
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err)
    } catch {
      return '[unserializable object]'
    }
  }
  if (typeof err === 'string') {
    return err
  }
  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint' || typeof err === 'symbol') {
    return String(err)
  }
  return '[unknown error]'
}

const errorKey = (err: unknown): string => {
  if (err instanceof Error) {
    // Dedupe by name+first-line-of-message. Same class + message = same shape.
    return `${err.name}::${err.message.split('\n', 1)[0] ?? ''}`
  }
  return summarizeError(err)
}

const groupByShape = (errors: ReadonlyArray<unknown>, limit: number): ReadonlyArray<ErrorShape> => {
  const map = new Map<string, ErrorShape>()
  for (const err of errors) {
    const key = errorKey(err)
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
    } else {
      map.set(key, { key, count: 1, sample: err })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

const formatShapes = (shapes: ReadonlyArray<ErrorShape>): string =>
  shapes
    .map((s, i) => `  [${i + 1}] (×${s.count}) ${summarizeError(s.sample)}`)
    .join('\n')

/**
 * Assert every Either in the array is Right. On failure, throws with a
 * structured message listing all distinct Left shapes, their frequency, and
 * the first sample of each.
 *
 * Prefer this over `expect(Either.isRight(o)).toBe(true)` inside a loop when
 * the array comes from a parallel / concurrency stress run — loop-based
 * assertions swallow the Left value.
 */
export const expectAllRight = <L, R>(
  outcomes: ReadonlyArray<Either.Either<R, L>>,
  options: ConcurrencyAssertionOptions
): void => {
  const lefts = outcomes.flatMap((o) => (Either.isLeft(o) ? [o.left] : []))
  if (lefts.length === 0) {
    return
  }
  const shapes = groupByShape(lefts, options.maxErrorSamples ?? 5)
  const header = `[${options.context}] ${lefts.length} of ${outcomes.length} returned Left`
  throw new Error(`${header}\n${formatShapes(shapes)}`)
}

/**
 * Assert every PromiseSettledResult in the array is fulfilled. On failure,
 * throws with the same structured shape as {@link expectAllRight}.
 *
 * Use this when your concurrency stress test runs raw promises (e.g. HTTP
 * requests via the test client) rather than Effect pipelines.
 */
export const expectAllFulfilled = <T>(
  results: ReadonlyArray<PromiseSettledResult<T>>,
  options: ConcurrencyAssertionOptions
): ReadonlyArray<T> => {
  const rejections: unknown[] = results.flatMap((r): unknown[] =>
    r.status === 'rejected' ? [r.reason as unknown] : []
  )
  if (rejections.length === 0) {
    return results.map((r): T => (r as PromiseFulfilledResult<T>).value)
  }
  const shapes = groupByShape(rejections, options.maxErrorSamples ?? 5)
  const header = `[${options.context}] ${rejections.length} of ${results.length} rejected`
  throw new Error(`${header}\n${formatShapes(shapes)}`)
}
