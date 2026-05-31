import {
  createSentryReporter,
  SENTRY_SPOTLIGHT_PLACEHOLDER_DSN
} from '@tx-agent-kit/observability/sentry'
import type { ApiEnv } from '../config/env.js'

// Thin API binding over the shared Sentry reporter (init/race/trace/withScope
// live in @tx-agent-kit/observability/sentry). Only the DSN resolution is
// API-specific.
const reporter = createSentryReporter()

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

export const flushApiSentry = (): Promise<void> => reporter.flush(2000)

export const _resetApiSentryForTest = (): void => {
  reporter.reset()
}
