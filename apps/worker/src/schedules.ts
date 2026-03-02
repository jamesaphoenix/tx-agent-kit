import type { Client } from '@temporalio/client'
import { isGrpcServiceError, ScheduleOverlapPolicy } from '@temporalio/client'
import { createLogger } from '@tx-agent-kit/logging'

/** gRPC status codes used by Temporal schedule operations */
const GRPC_NOT_FOUND = 5
const GRPC_ALREADY_EXISTS = 6

const logger = createLogger('tx-agent-kit-worker-schedules')
const OUTBOX_POLLER_SCHEDULE_ID = 'outbox-poller-schedule'
const STUCK_EVENTS_RESET_SCHEDULE_ID = 'stuck-events-reset-schedule'
const PRUNE_PUBLISHED_SCHEDULE_ID = 'prune-published-events-schedule'

export async function ensureOutboxPollerSchedule(
  client: Client,
  taskQueue: string,
  intervalSeconds: number,
  batchSize: number
): Promise<void> {
  const handle = client.schedule.getHandle(OUTBOX_POLLER_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalSeconds}s` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'outboxPollerWorkflow',
        taskQueue,
        args: [batchSize]
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated outbox poller schedule.', { intervalSeconds, batchSize })
  } catch (error: unknown) {
    const isNotFound =
      isGrpcServiceError(error) && (error.code as number) === GRPC_NOT_FOUND

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: OUTBOX_POLLER_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalSeconds}s` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'outboxPollerWorkflow',
          taskQueue,
          args: [batchSize]
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created outbox poller schedule.', { intervalSeconds, batchSize })
    } catch (createError: unknown) {
      const isAlreadyExists =
        isGrpcServiceError(createError) && (createError.code as number) === GRPC_ALREADY_EXISTS

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Outbox poller schedule already created by another worker instance.')
    }
  }
}

export async function ensureStuckEventsResetSchedule(
  client: Client,
  taskQueue: string,
  intervalSeconds: number,
  stuckThresholdMinutes: number
): Promise<void> {
  const handle = client.schedule.getHandle(STUCK_EVENTS_RESET_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalSeconds}s` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'resetStuckEventsWorkflow',
        taskQueue,
        args: [stuckThresholdMinutes]
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated stuck events reset schedule.', { intervalSeconds, stuckThresholdMinutes })
  } catch (error: unknown) {
    const isNotFound =
      isGrpcServiceError(error) && (error.code as number) === GRPC_NOT_FOUND

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: STUCK_EVENTS_RESET_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalSeconds}s` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'resetStuckEventsWorkflow',
          taskQueue,
          args: [stuckThresholdMinutes]
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created stuck events reset schedule.', { intervalSeconds, stuckThresholdMinutes })
    } catch (createError: unknown) {
      const isAlreadyExists =
        isGrpcServiceError(createError) && (createError.code as number) === GRPC_ALREADY_EXISTS

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Stuck events reset schedule already created by another worker instance.')
    }
  }
}

export async function ensurePrunePublishedSchedule(
  client: Client,
  taskQueue: string,
  intervalHours: number,
  retentionDays: number
): Promise<void> {
  const handle = client.schedule.getHandle(PRUNE_PUBLISHED_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalHours}h` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'prunePublishedEventsWorkflow',
        taskQueue,
        args: [retentionDays]
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated prune published events schedule.', { intervalHours, retentionDays })
  } catch (error: unknown) {
    const isNotFound =
      isGrpcServiceError(error) && (error.code as number) === GRPC_NOT_FOUND

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: PRUNE_PUBLISHED_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalHours}h` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'prunePublishedEventsWorkflow',
          taskQueue,
          args: [retentionDays]
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created prune published events schedule.', { intervalHours, retentionDays })
    } catch (createError: unknown) {
      const isAlreadyExists =
        isGrpcServiceError(createError) && (createError.code as number) === GRPC_ALREADY_EXISTS

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Prune published events schedule already created by another worker instance.')
    }
  }
}

