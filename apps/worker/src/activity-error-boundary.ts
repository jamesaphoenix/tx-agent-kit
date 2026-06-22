import { Context } from '@temporalio/activity'
import { ApplicationFailure } from '@temporalio/common'
import type {
  ActivityExecuteInput,
  ActivityInboundCallsInterceptor,
  Next
} from '@temporalio/worker'
import { createLogger } from '@tx-agent-kit/logging'
import {
  buildCauseReportError,
  causeLogContext,
  shouldLogEffectCause,
  toFlattenedCauseChain
} from '@tx-agent-kit/observability/effect-cause-summary'
import { runWithActivityContext } from './observability/activity-context.js'
import { captureWorkerActivityError } from './observability/sentry.js'

// The worker analogue of the API's mapCoreError/effectCauseLoggingMiddleware: a
// SINGLE place that logs + Sentry-captures every activity failure once, with
// workflow/activity/trace context. Re-throws unchanged so Temporal's retry and
// failure semantics are untouched.

const logger = createLogger('tx-agent-kit-worker-activity-boundary')

// Tags that are NOT faults even outside an ApplicationFailure. Empty today; the
// retryable-ApplicationFailure path (below) already covers the publish retries.
const workerExpectedErrorTags = new Set<string>()

// A failure is a reportable fault (error log + Sentry) when it's a NON-retryable
// ApplicationFailure (a permanent failure Temporal won't retry) or, for any
// other error, when the cause chain looks like a genuine fault. A retryable
// ApplicationFailure (Temporal will retry) is logged at warn without Sentry so
// transient publish retries don't flood error tracking.
const isReportableFault = (error: unknown): boolean =>
  error instanceof ApplicationFailure
    ? error.nonRetryable === true
    : shouldLogEffectCause(error, workerExpectedErrorTags)

export class ActivityErrorBoundaryInterceptor implements ActivityInboundCallsInterceptor {
  async execute(
    input: ActivityExecuteInput,
    next: Next<ActivityInboundCallsInterceptor, 'execute'>
  ): Promise<unknown> {
    const { info } = Context.current()
    const ctx = {
      workflowId: info.workflowExecution?.workflowId,
      runId: info.workflowExecution?.runId,
      activityId: info.activityId,
      activityType: info.activityType,
      attempt: info.attempt
    }

    return runWithActivityContext(ctx, async () => {
      try {
        return await next(input)
      } catch (error) {
        const logContext = { ...ctx, ...causeLogContext(error) }

        if (isReportableFault(error)) {
          logger.error(
            `Activity ${ctx.activityType} failed`,
            logContext,
            error instanceof Error ? error : undefined
          )
          const root = toFlattenedCauseChain(error).at(-1)
          captureWorkerActivityError(
            buildCauseReportError(error, { fallbackMessage: `Activity ${ctx.activityType} failed` }),
            {
              ...ctx,
              code: root?.code,
              rootCauseTag: root?.tag,
              rootCauseMessage: root?.message
            }
          )
        } else {
          logger.warn(`Activity ${ctx.activityType} failed; will retry`, logContext)
        }

        throw error
      }
    })
  }
}
