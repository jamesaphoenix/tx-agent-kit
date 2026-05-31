import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Per-activity context, the worker analogue of the API's request-context
 * (apps/api/src/observability/request-context.ts). Set once by the activity
 * error-boundary interceptor so any downstream log carries the workflow/activity
 * identifiers, mirroring how API logs carry operationId/routePattern.
 */
export interface ActivityContext {
  readonly workflowId?: string
  readonly runId?: string
  readonly activityId?: string
  readonly activityType?: string
  readonly attempt?: number
}

const activityContextStorage = new AsyncLocalStorage<ActivityContext>()

export const runWithActivityContext = <A>(
  context: ActivityContext,
  fn: () => Promise<A>
): Promise<A> => activityContextStorage.run(context, fn)

export const getActivityContext = (): ActivityContext =>
  activityContextStorage.getStore() ?? {}
