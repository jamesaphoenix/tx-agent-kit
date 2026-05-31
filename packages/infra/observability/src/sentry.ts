import { trace } from '@opentelemetry/api'

/**
 * Shared Sentry error-reporting core for the backend services (API + worker).
 *
 * Both services need the identical machinery: a one-time lazy `init` that
 * tolerates concurrent callers, trace-correlated scoped capture (tags +
 * fingerprint + contexts), a plain `captureException` for process crashes, and
 * a flush. Only two things differ per service and are supplied by the caller:
 *   1. DSN resolution + spotlight detection (env shapes differ) → `SentryInit`.
 *   2. The per-boundary tag/fingerprint/context shape → `ScopedCapture`.
 *
 * Each service creates ONE reporter (its own closure state) at module load;
 * because API and worker are separate processes, there is no shared singleton.
 */

export const SENTRY_SPOTLIGHT_PLACEHOLDER_DSN = 'https://spotlight@local/0'

// Method syntax + permissive return types so @sentry/node's concrete Scope
// (whose methods return `this`) is structurally assignable to this minimal view.
interface SentryScope {
  setTag(key: string, value: string): unknown
  setFingerprint(fingerprint: string[]): unknown
  setContext(key: string, context: Record<string, unknown> | null): unknown
}

interface SentryNodeModule {
  init: (options: {
    dsn: string
    environment: string
    tracesSampleRate: number
    spotlight?: boolean
  }) => void
  setTag: (key: string, value: string) => void
  // Method syntax (bivariant params) so @sentry/node's withScope — whose
  // callback receives the full Scope — is assignable to our narrow SentryScope.
  withScope(callback: (scope: SentryScope) => void): void
  captureException: (error: unknown) => unknown
  flush: (timeout?: number) => PromiseLike<unknown>
}

/** Resolved init inputs. The caller resolves the DSN (incl. spotlight placeholder). */
export interface SentryInit {
  /** Effective DSN; when absent, init is a no-op (returns false). */
  readonly dsn?: string
  readonly environment: string
  readonly spotlightEnabled: boolean
  /** `component` tag value, e.g. 'api' or 'worker'. */
  readonly component: string
}

/** A trace-correlated, fingerprinted Sentry capture for one error boundary. */
export interface ScopedCapture {
  /** `error_boundary` tag value, e.g. 'api_error_mapping' or 'worker_activity'. */
  readonly boundary: string
  /** Tags to set; `undefined` values are skipped. */
  readonly tags?: Readonly<Record<string, string | undefined>>
  /** Fingerprint parts; blank/undefined parts become 'unknown' so grouping stays stable. */
  readonly fingerprint?: ReadonlyArray<string | undefined>
  /** Named Sentry contexts (display detail, not searchable). */
  readonly contexts?: Readonly<Record<string, Record<string, unknown>>>
}

export interface SentryReporter {
  initialize: (init: SentryInit) => Promise<boolean>
  captureException: (error: unknown) => void
  captureScoped: (error: unknown, capture: ScopedCapture) => void
  flush: (timeoutMs?: number) => Promise<void>
  reset: () => void
}

/**
 * Resolve the active OTEL trace/span ids so each Sentry issue links back to the
 * full distributed trace (web → api → worker) in Jaeger/Spotlight. The Effect
 * OTEL tracer registers spans on the global OTEL context, so `getActiveSpan`
 * returns the current span when called inside the handler/activity fiber.
 */
const resolveActiveTrace = (): { traceId: string; spanId: string } | undefined => {
  const spanContext = trace.getActiveSpan()?.spanContext()
  if (!spanContext?.traceId) {
    return undefined
  }
  return { traceId: spanContext.traceId, spanId: spanContext.spanId }
}

const toFingerprintPart = (value: string | undefined): string =>
  typeof value === 'string' && value.trim().length > 0 ? value : 'unknown'

/** Build a reporter with its own private init/module state. */
export const createSentryReporter = (): SentryReporter => {
  let isInitialized = false
  let initializationPromise: Promise<boolean> | null = null
  let sentryModule: SentryNodeModule | null = null

  const resolveSentryModule = async (): Promise<SentryNodeModule> => {
    if (sentryModule) {
      return sentryModule
    }
    sentryModule = await import('@sentry/node')
    return sentryModule
  }

  const initialize = (init: SentryInit): Promise<boolean> => {
    if (isInitialized) {
      return Promise.resolve(false)
    }
    if (initializationPromise) {
      return initializationPromise
    }
    if (!init.dsn) {
      return Promise.resolve(false)
    }

    const dsn = init.dsn
    initializationPromise = (async () => {
      const Sentry = await resolveSentryModule()
      Sentry.init({
        dsn,
        environment: init.environment,
        tracesSampleRate: init.spotlightEnabled ? 1.0 : 0,
        spotlight: init.spotlightEnabled
      })
      Sentry.setTag('component', init.component)
      isInitialized = true
      return true
    })()

    const currentInitialization = initializationPromise
    return (async () => {
      try {
        return await currentInitialization
      } catch {
        // Init failed — reset so a later call can retry rather than wedging.
        isInitialized = false
        sentryModule = null
        return false
      } finally {
        if (initializationPromise === currentInitialization) {
          initializationPromise = null
        }
      }
    })()
  }

  const captureException = (error: unknown): void => {
    if (!isInitialized || !sentryModule) {
      return
    }
    sentryModule.captureException(error)
  }

  const captureScoped = (error: unknown, capture: ScopedCapture): void => {
    const mod = sentryModule
    if (!isInitialized || !mod) {
      return
    }

    const activeTrace = resolveActiveTrace()
    mod.withScope((scope) => {
      scope.setTag('error_boundary', capture.boundary)
      if (capture.tags) {
        for (const [key, value] of Object.entries(capture.tags)) {
          if (value !== undefined) {
            scope.setTag(key, value)
          }
        }
      }
      // Trace ids are unique per request — searchable tags, never fingerprinted
      // (that would explode issue grouping into one issue per request).
      if (activeTrace) {
        scope.setTag('trace_id', activeTrace.traceId)
        scope.setTag('span_id', activeTrace.spanId)
      }
      if (capture.fingerprint) {
        scope.setFingerprint(capture.fingerprint.map(toFingerprintPart))
      }
      if (capture.contexts) {
        for (const [key, context] of Object.entries(capture.contexts)) {
          scope.setContext(key, context)
        }
      }
      mod.captureException(error)
    })
  }

  const flush = async (timeoutMs = 2000): Promise<void> => {
    if (!isInitialized || !sentryModule) {
      return
    }
    await sentryModule.flush(timeoutMs)
  }

  const reset = (): void => {
    isInitialized = false
    initializationPromise = null
    sentryModule = null
  }

  return { initialize, captureException, captureScoped, flush, reset }
}
