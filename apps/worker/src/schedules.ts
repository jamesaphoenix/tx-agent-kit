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

const logger = createLogger('tx-agent-kit-worker-schedules')
const OUTBOX_POLLER_SCHEDULE_ID = 'outbox-poller-schedule'
const STUCK_EVENTS_RESET_SCHEDULE_ID = 'stuck-events-reset-schedule'
const PRUNE_PUBLISHED_SCHEDULE_ID = 'prune-published-events-schedule'
const RETENTION_CLEANER_SCHEDULE_ID = 'retention-cleaner-schedule'
const RELEASE_STALE_RESERVATIONS_SCHEDULE_ID = 'release-stale-reservations-schedule'
const AUTO_RECHARGE_RETRY_SCHEDULE_ID = 'auto-recharge-retry-schedule'
const STORAGE_RECONCILE_SCHEDULE_ID = 'storage-reconcile-schedule'

/**
 * Cron expression for the nightly storage reconciliation sweep: 03:00 UTC
 * every day. Matches the spec exactly — see
 * `specs/design/billing-and-pricing-design.md` §"Monthly Storage
 * Reconciliation" which mandates a nightly sweep to charge ongoing
 * storage overage for orgs whose `storage_usage.period_end` has rolled
 * over.
 *
 * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
 */
const STORAGE_RECONCILE_CRON = '0 3 * * *'

const isScheduleNotFound = (error: unknown): boolean =>
  error instanceof ScheduleNotFoundError
  || (isGrpcServiceError(error) && (error.code as number) === GRPC_NOT_FOUND)

const isScheduleAlreadyExists = (error: unknown): boolean =>
  error instanceof ScheduleAlreadyRunning
  || (isGrpcServiceError(error) && (error.code as number) === GRPC_ALREADY_EXISTS)

/**
 * Remove the legacy 5s outbox-poller schedule.
 *
 * The outbox is now drained by the event-driven dispatcher (`dispatch/outbox-dispatcher.ts`,
 * woken by Postgres NOTIFY), so the schedule must be deleted or it keeps cold-starting
 * `outboxPollerWorkflow` every 5s and burning Temporal Actions. Idempotent: a missing
 * schedule is the success case. Runs on every worker boot so the orphaned Cloud
 * schedule is reaped the first time the new code deploys.
 */
export async function deleteOutboxPollerScheduleIfExists(client: Client): Promise<void> {
  const handle = client.schedule.getHandle(OUTBOX_POLLER_SCHEDULE_ID)

  try {
    await handle.delete()
    logger.info('Deleted legacy outbox poller schedule (replaced by event-driven dispatcher).')
  } catch (error: unknown) {
    if (isScheduleNotFound(error)) {
      return
    }
    throw error
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
    const isNotFound = isScheduleNotFound(error)

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
      const isAlreadyExists = isScheduleAlreadyExists(createError)

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
    const isNotFound = isScheduleNotFound(error)

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
      const isAlreadyExists = isScheduleAlreadyExists(createError)

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Prune published events schedule already created by another worker instance.')
    }
  }
}

/**
 * Schedule the orphan-reservation reclaim workflow.
 *
 * @spec INV-BILLING-003 — a scheduled Temporal workflow scans for
 * reservations older than `maxAgeSeconds` and releases them back to the
 * balance with a `release` credit_ledger entry.
 */
export async function ensureReleaseStaleReservationsSchedule(
  client: Client,
  taskQueue: string,
  intervalMinutes: number,
  maxAgeSeconds: number
): Promise<void> {
  const handle = client.schedule.getHandle(RELEASE_STALE_RESERVATIONS_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalMinutes}m` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'releaseStaleReservationsWorkflow',
        taskQueue,
        args: [maxAgeSeconds]
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated release stale reservations schedule.', {
      intervalMinutes,
      maxAgeSeconds
    })
  } catch (error: unknown) {
    const isNotFound = isScheduleNotFound(error)

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: RELEASE_STALE_RESERVATIONS_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalMinutes}m` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'releaseStaleReservationsWorkflow',
          taskQueue,
          args: [maxAgeSeconds]
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created release stale reservations schedule.', {
        intervalMinutes,
        maxAgeSeconds
      })
    } catch (createError: unknown) {
      const isAlreadyExists = isScheduleAlreadyExists(createError)

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Release stale reservations schedule already created by another worker instance.')
    }
  }
}

/**
 * Schedule the auto-recharge retry workflow.
 *
 * @spec billing-and-pricing-design §"Auto-recharge retry policy" — a
 * scheduled Temporal workflow scans `auto_recharge_attempts` for failed
 * rows whose `next_retry_at` has elapsed and re-fires the trigger.
 */
export async function ensureAutoRechargeRetrySchedule(
  client: Client,
  taskQueue: string,
  intervalMinutes: number
): Promise<void> {
  const handle = client.schedule.getHandle(AUTO_RECHARGE_RETRY_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalMinutes}m` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'autoRechargeRetryWorkflow',
        taskQueue,
        args: []
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated auto-recharge retry schedule.', { intervalMinutes })
  } catch (error: unknown) {
    const isNotFound = isScheduleNotFound(error)

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: AUTO_RECHARGE_RETRY_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalMinutes}m` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'autoRechargeRetryWorkflow',
          taskQueue,
          args: []
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created auto-recharge retry schedule.', { intervalMinutes })
    } catch (createError: unknown) {
      const isAlreadyExists = isScheduleAlreadyExists(createError)

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Auto-recharge retry schedule already created by another worker instance.')
    }
  }
}

export async function ensureRetentionCleanerSchedule(
  client: Client,
  taskQueue: string,
  intervalHours: number,
  retentionHours: number
): Promise<void> {
  const handle = client.schedule.getHandle(RETENTION_CLEANER_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        intervals: [{ every: `${intervalHours}h` }]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'retentionCleanerWorkflow',
        taskQueue,
        args: [retentionHours]
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated retention cleaner schedule.', { intervalHours, retentionHours })
  } catch (error: unknown) {
    const isNotFound = isScheduleNotFound(error)

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: RETENTION_CLEANER_SCHEDULE_ID,
        spec: {
          intervals: [{ every: `${intervalHours}h` }]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'retentionCleanerWorkflow',
          taskQueue,
          args: [retentionHours]
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created retention cleaner schedule.', { intervalHours, retentionHours })
    } catch (createError: unknown) {
      const isAlreadyExists = isScheduleAlreadyExists(createError)

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Retention cleaner schedule already created by another worker instance.')
    }
  }
}

/**
 * Schedule the nightly storage overage reconciliation workflow. The workflow
 * walks every org whose `storage_usage.period_end` has rolled over and calls
 * `StorageBillingService.reconcileMonthlyOverage` for each candidate.
 *
 * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
 */
export async function ensureStorageReconcileSchedule(
  client: Client,
  taskQueue: string
): Promise<void> {
  const handle = client.schedule.getHandle(STORAGE_RECONCILE_SCHEDULE_ID)

  try {
    await handle.describe()
    await handle.update((prev) => ({
      ...prev,
      spec: {
        cronExpressions: [STORAGE_RECONCILE_CRON]
      },
      action: {
        type: 'startWorkflow' as const,
        workflowType: 'storageReconcileWorkflow',
        taskQueue,
        args: []
      },
      policies: {
        ...prev.policies,
        overlap: ScheduleOverlapPolicy.SKIP
      }
    }))
    logger.info('Updated storage reconcile schedule.', { cron: STORAGE_RECONCILE_CRON })
  } catch (error: unknown) {
    const isNotFound = isScheduleNotFound(error)

    if (!isNotFound) {
      throw error
    }

    try {
      await client.schedule.create({
        scheduleId: STORAGE_RECONCILE_SCHEDULE_ID,
        spec: {
          cronExpressions: [STORAGE_RECONCILE_CRON]
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'storageReconcileWorkflow',
          taskQueue,
          args: []
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP
        }
      })
      logger.info('Created storage reconcile schedule.', { cron: STORAGE_RECONCILE_CRON })
    } catch (createError: unknown) {
      const isAlreadyExists = isScheduleAlreadyExists(createError)

      if (!isAlreadyExists) {
        throw createError
      }

      logger.info('Storage reconcile schedule already created by another worker instance.')
    }
  }
}
