import {
  createSentryReporter,
  SENTRY_SPOTLIGHT_PLACEHOLDER_DSN
} from '@tx-agent-kit/observability/sentry'
import type { WorkerEnv } from '../config/env.js'

// Thin worker binding over the shared Sentry reporter (init/race/trace/withScope
// live in @tx-agent-kit/observability/sentry). Only the DSN resolution is
// worker-specific.
const reporter = createSentryReporter()

export const initializeWorkerSentry = (env: WorkerEnv): Promise<boolean> => {
  const spotlightEnabled = env.SENTRY_SPOTLIGHT
  const dsn =
    env.WORKER_SENTRY_DSN ?? (spotlightEnabled ? SENTRY_SPOTLIGHT_PLACEHOLDER_DSN : undefined)

  return reporter.initialize({
    dsn,
    environment: env.NODE_ENV,
    spotlightEnabled,
    component: 'worker'
  })
}

export const captureWorkerException = (error: unknown): void => {
  reporter.captureException(error)
}

export const flushWorkerSentry = (): Promise<void> => reporter.flush(2000)

export const _resetWorkerSentryForTest = (): void => {
  reporter.reset()
}
