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

/** Context for a worker activity failure, mirroring the API's mapped-error shape. */
export interface WorkerActivityErrorContext {
  readonly workflowId?: string
  readonly runId?: string
  readonly activityId?: string
  readonly activityType?: string
  readonly attempt?: number
  readonly code?: string
  readonly rootCauseTag?: string
  readonly rootCauseMessage?: string
}

/**
 * Capture a worker ACTIVITY failure with the same searchable shape as the API's
 * mapped-error boundary: a stable fingerprint (so the same fault clusters) plus
 * workflow/activity tags. trace_id/span_id correlation is added by the shared
 * reporter's captureScoped. Used by the activity error boundary — distinct from
 * captureWorkerException, which is for process-level crashes.
 */
export const captureWorkerActivityError = (
  error: unknown,
  context: WorkerActivityErrorContext
): void => {
  reporter.captureScoped(error, {
    boundary: 'worker_activity',
    tags: {
      activity_type: context.activityType,
      workflow_id: context.workflowId,
      core_error_code: context.code,
      root_cause_tag: context.rootCauseTag
    },
    fingerprint: [
      'worker-activity-error',
      context.activityType,
      context.code,
      context.rootCauseTag,
      context.rootCauseMessage
    ],
    contexts: { activity: { ...context } }
  })
}

export const flushWorkerSentry = (): Promise<void> => reporter.flush(2000)

export const _resetWorkerSentryForTest = (): void => {
  reporter.reset()
}
