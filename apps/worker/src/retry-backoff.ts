/**
 * Capped exponential backoff for worker-process control-plane calls (connecting
 * to Temporal, describing the namespace, reconciling schedules). Workflow code
 * must NOT use this: it reads the wall clock and Math.random.
 *
 * Incident 2026-11-23: Temporal's Postgres was down for days and then slow
 * (DEADLINE_EXCEEDED) for hours. A single failed schedule describe at boot
 * crashed the worker into a restart loop. These helpers let a transient outage
 * be waited out in-process, logged at warn, and escalated to error only once it
 * has lasted long enough to need a human.
 */

export interface BackoffPolicy {
  /** Delay after the first failure. */
  readonly initialDelayMs: number
  /** Upper bound on any single delay. */
  readonly maxDelayMs: number
  /** Growth factor per attempt. */
  readonly multiplier: number
  /**
   * Fraction (0 to 1) of each delay that is randomised away, so a fleet of
   * workers recovering together does not retry in lockstep.
   */
  readonly jitterRatio: number
}

export interface RetryLogger {
  readonly info: (message: string, context?: Record<string, unknown>) => void
  readonly warn: (message: string, context?: Record<string, unknown>) => void
  readonly error: (message: string, context?: Record<string, unknown>) => void
}

/** Thrown when a retry loop stops because its AbortSignal fired. */
export class RetryAbortedError extends Error {
  constructor(label = 'retry') {
    super(`${label} aborted`)
    this.name = 'RetryAbortedError'
  }
}

/**
 * Delay before retry number `attempt` (1-based: the wait after the first
 * failure is attempt 1). Always within
 * [(1 - jitterRatio) * base, base] where base = min(maxDelayMs, initial * multiplier^(attempt-1)).
 */
export const computeBackoffDelayMs = (
  policy: BackoffPolicy,
  attempt: number,
  random: () => number = Math.random
): number => {
  const exponent = Math.max(0, Math.floor(attempt) - 1)
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.multiplier ** exponent)
  const jitterRatio = Math.min(1, Math.max(0, policy.jitterRatio))
  return Math.floor(base - base * jitterRatio * random())
}

/**
 * setTimeout as a promise that rejects with RetryAbortedError as soon as the
 * signal aborts. The timer is deliberately ref'd: during startup nothing else
 * may hold the event loop open, and an unref'd wait would let the process exit 0.
 */
export const sleepWithSignal = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RetryAbortedError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new RetryAbortedError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export interface ReconcileStep {
  /** Stable identifier used in logs. */
  readonly name: string
  /** Must be idempotent: it may run again after a partial failure. */
  readonly run: () => Promise<void>
}

export interface ReconcileStepFailure {
  readonly step: string
  readonly error: unknown
}

/** One reconciliation pass finished with some steps still failing. */
export class ReconciliationIncompleteError extends Error {
  readonly failedSteps: ReadonlyArray<string>

  constructor(readonly failures: ReadonlyArray<ReconcileStepFailure>) {
    super(
      `Reconciliation incomplete: ${failures
        .map(({ step, error }) => `${step}: ${error instanceof Error ? error.message : String(error)}`)
        .join('; ')}`
    )
    this.name = 'ReconciliationIncompleteError'
    this.failedSteps = failures.map(({ step }) => step)
  }
}

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

export interface RetryOptions {
  /** Human-readable operation name, used as the log message prefix. */
  readonly label: string
  readonly policy: BackoffPolicy
  /** Failures log at warn until this much time has passed, then at error. */
  readonly escalateAfterMs: number
  /**
   * Stop retrying (rethrowing the last error) once the next wait would pass this
   * much elapsed time. Omit to retry until the signal aborts.
   */
  readonly maxElapsedMs?: number
  /** Start of the elapsed-time clock; pass one value to share a budget across calls. */
  readonly startedAtMs?: number
  /** Return false for errors that retrying cannot fix. Defaults to retrying everything. */
  readonly isRetryable?: (error: unknown) => boolean
  /** Called once, with the error, the first time failures escalate to error level. */
  readonly onEscalate?: (error: unknown) => void
  readonly signal?: AbortSignal
  readonly logger: RetryLogger
  readonly now?: () => number
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly random?: () => number
}

/**
 * Run `operation` until it succeeds, waiting with capped exponential backoff
 * between failures. Rejects with the last error when the operation fails with a
 * non-retryable error or the elapsed budget runs out, and with RetryAbortedError
 * when the signal aborts.
 */
export const retryWithBackoff = async <T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> => {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepWithSignal
  const random = options.random ?? Math.random
  const startedAtMs = options.startedAtMs ?? now()
  const { label, signal, logger } = options
  let escalated = false

  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted) {
      throw new RetryAbortedError(label)
    }

    try {
      const result = await operation(attempt)
      if (attempt > 1) {
        logger.info(`${label} succeeded after retrying.`, {
          attempts: attempt,
          elapsedMs: now() - startedAtMs
        })
      }
      return result
    } catch (error: unknown) {
      if (error instanceof RetryAbortedError || signal?.aborted) {
        throw new RetryAbortedError(label)
      }

      const elapsedMs = now() - startedAtMs
      const context: Record<string, unknown> = {
        attempt,
        elapsedMs,
        error: describeError(error),
        ...(error instanceof ReconciliationIncompleteError ? { failedSteps: error.failedSteps } : {})
      }

      if (options.isRetryable && !options.isRetryable(error)) {
        logger.error(`${label} failed with an error that retrying cannot fix.`, context)
        throw error
      }

      const nextDelayMs = computeBackoffDelayMs(options.policy, attempt, random)
      if (options.maxElapsedMs !== undefined && elapsedMs + nextDelayMs > options.maxElapsedMs) {
        logger.error(`${label} is still failing; giving up.`, {
          ...context,
          maxElapsedMs: options.maxElapsedMs
        })
        throw error
      }

      if (elapsedMs < options.escalateAfterMs) {
        logger.warn(`${label} failed; retrying with backoff.`, { ...context, nextDelayMs })
      } else {
        logger.error(`${label} is still failing after retrying; retrying with backoff.`, {
          ...context,
          nextDelayMs
        })
        if (!escalated) {
          escalated = true
          options.onEscalate?.(error)
        }
      }

      await sleep(nextDelayMs, signal)
    }
  }
}

/**
 * Run idempotent steps in order until every one has succeeded. Each pass runs
 * every step still pending, so one persistently failing step never blocks the
 * steps after it, and a step that has succeeded is not run again. Passes are
 * spaced with backoff (see retryWithBackoff, which supplies logging,
 * escalation and abort handling).
 */
export const reconcileUntilComplete = async (
  steps: ReadonlyArray<ReconcileStep>,
  options: RetryOptions
): Promise<void> => {
  const pending = [...steps]

  await retryWithBackoff(async () => {
    // Take this pass's steps out of `pending`; failures go back in, in order.
    const thisPass = pending.splice(0, pending.length)
    const failures: ReconcileStepFailure[] = []
    for (const step of thisPass) {
      if (options.signal?.aborted) {
        throw new RetryAbortedError(options.label)
      }
      try {
        await step.run()
      } catch (error: unknown) {
        failures.push({ step: step.name, error })
        pending.push(step)
      }
    }
    if (failures.length > 0) {
      throw new ReconciliationIncompleteError(failures)
    }
  }, options)
}
