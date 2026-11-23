import type { BackoffPolicy } from './retry-backoff.js'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS

/**
 * Boot: connect to Temporal, describe the namespace, create the workers.
 *
 * Retries in-process rather than crash-looping. After 5 minutes each failure
 * logs at error. After 30 minutes the boot gives up and the process exits 1,
 * so the container restart policy gives it a fresh process (and Sentry gets one
 * event per half hour of outage, not one per crash).
 */
export const TEMPORAL_STARTUP_RETRY: {
  readonly policy: BackoffPolicy
  readonly escalateAfterMs: number
  readonly maxElapsedMs: number
} = {
  policy: { initialDelayMs: SECOND_MS, maxDelayMs: 30 * SECOND_MS, multiplier: 2, jitterRatio: 0.2 },
  escalateAfterMs: 5 * MINUTE_MS,
  maxElapsedMs: 30 * MINUTE_MS
}

/**
 * Background work after the workers are polling: the schedule client
 * connection, the outbox dispatcher start, schedule reconciliation and the
 * campaign definition sync.
 *
 * Retries until it succeeds or the worker shuts down; it never stops the
 * workers. Failures log at warn for 30 minutes, then at error, and the first
 * escalation is reported to Sentry once.
 */
export const BACKGROUND_RECONCILE_RETRY: {
  readonly policy: BackoffPolicy
  readonly escalateAfterMs: number
} = {
  policy: { initialDelayMs: 5 * SECOND_MS, maxDelayMs: 5 * MINUTE_MS, multiplier: 2, jitterRatio: 0.2 },
  escalateAfterMs: 30 * MINUTE_MS
}

/**
 * Once the run loop has ended (a worker stopped, or a signal arrived), the
 * process exits within this long even if draining or cleanup hangs, for example
 * a connection close that never returns while Temporal is unreachable. Covers
 * the workers' 30s shutdownGraceTime plus cleanup.
 */
export const WORKER_EXIT_BACKSTOP_MS = 60 * SECOND_MS

/** gRPC DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED and UNAVAILABLE. */
const TRANSIENT_GRPC_CODES = new Set([4, 8, 14])
const TRANSIENT_MESSAGE =
  /unavailable|deadline.?exceeded|resource.?exhausted|timed? ?out|econnrefused|econnreset|enotfound|eai_again|could not be described|no usable database connection/i

/**
 * Whether an error looks like Temporal (or the network to it) being down or
 * overloaded, as opposed to a bug that will fail identically every time (for
 * example a workflow bundle that does not compile). Used where a retry costs
 * real work, such as Worker.create re-bundling the workflow code.
 */
export const isTransientTemporalError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }
  if (error.name === 'TransportError') {
    return true
  }
  const { code } = error as { readonly code?: unknown }
  if (typeof code === 'number' && TRANSIENT_GRPC_CODES.has(code)) {
    return true
  }
  return TRANSIENT_MESSAGE.test(error.message) || isTransientTemporalError(error.cause)
}
