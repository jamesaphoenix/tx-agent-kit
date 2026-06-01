import {
  createSentryReporter,
  SENTRY_SPOTLIGHT_PLACEHOLDER_DSN
} from '@tx-agent-kit/observability/sentry'
import type { ApiEnv } from '../config/env.js'

// Thin API binding over the shared Sentry reporter (init/race/trace/withScope
// live in @tx-agent-kit/observability/sentry). Only the DSN resolution and the
// `api_error_mapping` boundary shape are API-specific.
const reporter = createSentryReporter()

export type ApiMappedErrorContext = Record<string, unknown> & {
  readonly code?: string
  readonly httpErrorTag?: string
  readonly causeCode?: string
  readonly rootCauseTag?: string
  readonly method?: string
  readonly operationId?: string
  readonly path?: string
  readonly routePattern?: string
}

const parseBooleanString = (value: string | undefined): boolean => {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
}

export const initializeApiSentry = (env: ApiEnv): Promise<boolean> => {
  const spotlightEnabled = parseBooleanString(env.SENTRY_SPOTLIGHT)
  const dsn = env.API_SENTRY_DSN ?? (spotlightEnabled ? SENTRY_SPOTLIGHT_PLACEHOLDER_DSN : undefined)

  return reporter.initialize({
    dsn,
    environment: env.NODE_ENV,
    spotlightEnabled,
    component: 'api'
  })
}

export const captureApiException = (error: unknown): void => {
  reporter.captureException(error)
}

/**
 * Capture a mapped API failure with searchable Sentry context: a stable
 * fingerprint (so the same fault clusters) plus operation/route/cause tags. The
 * shared reporter adds the trace_id/span_id tags automatically.
 */
export const captureApiMappedError = (
  error: Error,
  context: ApiMappedErrorContext
): void => {
  const rootCauseMessage =
    typeof context.rootCauseMessage === 'string' ? context.rootCauseMessage : undefined

  reporter.captureScoped(error, {
    boundary: 'api_error_mapping',
    tags: {
      core_error_code: context.code,
      http_error_tag: context.httpErrorTag,
      cause_code: context.causeCode,
      root_cause_tag: context.rootCauseTag,
      operation_id: context.operationId,
      route: context.routePattern,
      http_method: context.method
    },
    fingerprint: [
      'api-mapped-error',
      context.operationId ?? context.routePattern,
      context.code,
      context.httpErrorTag,
      context.rootCauseTag ?? context.causeCode,
      rootCauseMessage
    ],
    contexts: {
      api_request: {
        method: context.method,
        path: context.path,
        routePattern: context.routePattern,
        operationId: context.operationId
      },
      api_error_mapping: context
    }
  })
}

export const flushApiSentry = (): Promise<void> => reporter.flush(2000)

export const _resetApiSentryForTest = (): void => {
  reporter.reset()
}
