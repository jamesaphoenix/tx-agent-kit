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

const isScheduleNotFound = (error: unknown): boolean =>
  error instanceof ScheduleNotFoundError
  || (isGrpcServiceError(error) && (error.code as number) === GRPC_NOT_FOUND)

const isScheduleAlreadyExists = (error: unknown): boolean =>
  error instanceof ScheduleAlreadyRunning
  || (isGrpcServiceError(error) && (error.code as number) === GRPC_ALREADY_EXISTS)

const EMAIL_SENDS_PRUNE_SCHEDULE_ID = 'email-sends-prune-schedule'

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
    if (!isScheduleNotFound(error)) {
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
      if (!isScheduleAlreadyExists(createError)) {
        throw createError
      }
      logger.info('Email sends prune schedule already created by another worker instance.')
    }
  }
}

const DRIP_SWEEP_SCHEDULE_ID = 'drip-sweep-schedule'

/**
 * The drip SWEEP schedule: one scheduled run every `intervalMinutes` drains the
 * due queue via dripSweepWorkflow. This replaces all per-enrollment sleeping
 * workflows, so Temporal action cost is flat (O(sweeps)). SKIP overlap keeps at
 * most one sweep running at a time.
 */
export async function ensureDripSweepSchedule(
  client: Client,
  taskQueue: string,
  intervalMinutes: number,
  batchSize: number,
  maxBatches: number
): Promise<void> {
  const handle = client.schedule.getHandle(DRIP_SWEEP_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalMinutes}m` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'dripSweepWorkflow',
        taskQueue,
        args: [batchSize, maxBatches]
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated drip sweep schedule.', { intervalMinutes, batchSize, maxBatches })
  } catch (error: unknown) {
    if (!isScheduleNotFound(error)) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: DRIP_SWEEP_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalMinutes}m` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'dripSweepWorkflow',
          taskQueue,
          args: [batchSize, maxBatches]
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created drip sweep schedule.', { intervalMinutes, batchSize, maxBatches })
    } catch (createError: unknown) {
      if (!isScheduleAlreadyExists(createError)) {
        throw createError
      }
      logger.info('Drip sweep schedule already created by another worker instance.')
    }
  }
}

const LIFECYCLE_SCAN_SCHEDULE_ID = 'lifecycle-scan-schedule'

/**
 * The one activity scan schedule: a daily run of lifecycleScanWorkflow evaluates
 * the activity checks per team (missed activation deadlines + inactivity + churn)
 * and emits the matching lifecycle.* events. The inactivity window in the scan
 * rules assumes a daily cadence, so keep `intervalHours` at 24 unless that window
 * is widened too. SKIP overlap keeps at most one scan running. Runs on the
 * DEFAULT task queue (where scanTeamActivity is registered).
 */
export async function ensureLifecycleScanSchedule(
  client: Client,
  taskQueue: string,
  intervalHours: number
): Promise<void> {
  const handle = client.schedule.getHandle(LIFECYCLE_SCAN_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalHours}h` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'lifecycleScanWorkflow',
        taskQueue,
        args: []
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated lifecycle scan schedule.', { intervalHours })
  } catch (error: unknown) {
    if (!isScheduleNotFound(error)) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: LIFECYCLE_SCAN_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalHours}h` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'lifecycleScanWorkflow',
          taskQueue,
          args: []
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created lifecycle scan schedule.', { intervalHours })
    } catch (createError: unknown) {
      if (!isScheduleAlreadyExists(createError)) {
        throw createError
      }
      logger.info('Lifecycle scan schedule already created by another worker instance.')
    }
  }
}
