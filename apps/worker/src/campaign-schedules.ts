import type { Client } from '@temporalio/client'
import {
  isGrpcServiceError,
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy
} from '@temporalio/client'
import { createLogger } from '@tx-agent-kit/logging'

/** gRPC status codes used by Temporal schedule operations */
const GRPC_NOT_FOUND = 5
const GRPC_ALREADY_EXISTS = 6

const logger = createLogger('tx-agent-kit-worker-campaign-schedules')
const EMAIL_SENDS_PRUNE_SCHEDULE_ID = 'email-sends-prune-schedule'

const isScheduleNotFound = (error: unknown): boolean =>
  error instanceof ScheduleNotFoundError
  || (isGrpcServiceError(error) && (error.code as number) === GRPC_NOT_FOUND)

const isScheduleAlreadyExists = (error: unknown): boolean =>
  error instanceof ScheduleAlreadyRunning
  || (isGrpcServiceError(error) && (error.code as number) === GRPC_ALREADY_EXISTS)

export async function ensureEmailSendsPruneSchedule(
  client: Client,
  taskQueue: string,
  intervalHours: number,
  retentionDays: number
): Promise<void> {
  const handle = client.schedule.getHandle(EMAIL_SENDS_PRUNE_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalHours}h` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'pruneEmailSendsWorkflow',
        taskQueue,
        args: [retentionDays]
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated email sends prune schedule.', { intervalHours, retentionDays })
  } catch (error: unknown) {
    const isNotFound = isScheduleNotFound(error)

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: EMAIL_SENDS_PRUNE_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalHours}h` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'pruneEmailSendsWorkflow',
          taskQueue,
          args: [retentionDays]
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created email sends prune schedule.', { intervalHours, retentionDays })
    } catch (createError: unknown) {
      const isAlreadyExists = isScheduleAlreadyExists(createError)

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Email sends prune schedule already created by another worker instance.')
    }
  }
}
