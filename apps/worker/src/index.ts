import { Client, Connection } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { ActivityErrorBoundaryInterceptor } from './activity-error-boundary.js'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { closeRedisClients } from '@tx-agent-kit/redis'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { combinedActivities } from './activities.js'
import { campaignActivities } from './campaign-activities.js'
import {
  getWorkerEnv,
  resolveWorkerTemporalConnectionOptions,
  type WorkerEnv
} from './config/env.js'
import {
  ensureAutoRechargeRetrySchedule,
  ensureStorageReconcileSchedule,
  deleteOutboxPollerScheduleIfExists,
  ensurePrunePublishedSchedule,
  ensureReleaseStaleReservationsSchedule,
  ensureRetentionCleanerSchedule,
  ensureStuckEventsResetSchedule
} from './schedules.js'
import {
  startOutboxDispatcher,
  type OutboxDispatcherHandle
} from './dispatch/outbox-dispatcher.js'
import { ensureEmailSendsPruneSchedule } from './campaign-schedules.js'
import {
  captureWorkerException,
  flushWorkerSentry,
  initializeWorkerSentry
} from './observability/sentry.js'

const logger = createLogger('tx-agent-kit-worker')

const toErrorLogContext = (error: unknown) =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) }

const shutdownWorkerIfRunning = (worker: Worker, taskQueue: string): void => {
  const state = worker.getState()
  if (state !== 'RUNNING') {
    logger.info('Temporal worker shutdown skipped because it is not running.', {
      taskQueue,
      state
    })
    return
  }

  try {
    worker.shutdown()
  } catch (error) {
    logger.warn('Temporal worker shutdown failed.', {
      taskQueue,
      state,
      error: toErrorLogContext(error)
    })
  }
}

async function run(env: WorkerEnv): Promise<void> {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url))
  const workflowJsPath = path.join(sourceDir, 'workflows.js')
  const workflowSourcePath = existsSync(workflowJsPath)
    ? workflowJsPath
    : path.join(sourceDir, 'workflows.ts')

  const campaignWorkflowJsPath = path.join(sourceDir, 'campaign-workflows.js')
  const campaignWorkflowSourcePath = existsSync(campaignWorkflowJsPath)
    ? campaignWorkflowJsPath
    : path.join(sourceDir, 'campaign-workflows.ts')

  startTelemetry('tx-agent-kit-worker')

  // Centralized activity error boundary: logs + Sentry-captures every activity
  // failure once (parity with the API's mapCoreError boundary), then re-throws
  // unchanged so Temporal retry semantics are untouched. Registered as an
  // activity inbound interceptor over all run sites.
  const activityInterceptors = [
    () => ({ inbound: new ActivityErrorBoundaryInterceptor() })
  ]

  const connOpts = resolveWorkerTemporalConnectionOptions(env)

  const connection = await NativeConnection.connect(connOpts)
  const testPollerOptions = env.NODE_ENV === 'test'
    ? {
        maxConcurrentWorkflowTaskPolls: 1,
        maxConcurrentActivityTaskPolls: 1
      }
    : {}

  try {
    const worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: workflowSourcePath,
      activities: combinedActivities,
      interceptors: { activity: activityInterceptors },
      shutdownGraceTime: '30s',
      ...testPollerOptions
    })

    const emailCampaignWorker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.EMAIL_CAMPAIGNS_TASK_QUEUE,
      workflowsPath: campaignWorkflowSourcePath,
      activities: campaignActivities,
      interceptors: { activity: activityInterceptors },
      shutdownGraceTime: '30s',
      ...testPollerOptions
    })

    let clientConnection: Connection | undefined
    let outboxDispatcher: OutboxDispatcherHandle | null = null
    let tlsConfig: Record<string, unknown> = {}
    if (typeof connOpts.tls === 'object') {
      tlsConfig = {
        tls: {
          serverNameOverride: connOpts.tls.serverNameOverride,
          serverRootCACertificate: connOpts.tls.serverRootCACertificate,
          clientCertPair: connOpts.tls.clientCertPair
        }
      }
    } else if (connOpts.tls === true) {
      tlsConfig = { tls: true }
    }
    const workerRun = worker.run()
    const emailCampaignWorkerRun = emailCampaignWorker.run()
    const workerRuns = Promise.all([
      workerRun,
      emailCampaignWorkerRun
    ])
    void (async () => {
      try {
        await workerRuns
      } catch {
        // The rejection is awaited below; attach a handler now to avoid a
        // transient unhandled-rejection while schedule reconciliation runs.
      }
    })()

    let shuttingDown = false
    let shutdownSignal = 'worker.run completed'
    const requestShutdown = (signal: string) => {
      if (shuttingDown) {
        return
      }

      shuttingDown = true
      shutdownSignal = signal
      logger.info('Stopping Temporal workers.', { signal })
      shutdownWorkerIfRunning(worker, env.TEMPORAL_TASK_QUEUE)
      shutdownWorkerIfRunning(emailCampaignWorker, env.EMAIL_CAMPAIGNS_TASK_QUEUE)
    }

    const onSigint = () => {
      requestShutdown('SIGINT')
    }
    const onSigterm = () => {
      requestShutdown('SIGTERM')
    }

    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)

    logger.info('Temporal worker started.', {
      runtimeMode: env.TEMPORAL_RUNTIME_MODE,
      address: env.TEMPORAL_ADDRESS,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      emailCampaignsTaskQueue: env.EMAIL_CAMPAIGNS_TASK_QUEUE
    })

    try {
      clientConnection = await Connection.connect({
        address: connOpts.address,
        ...tlsConfig,
        ...(connOpts.apiKey
          ? {
              metadata: { 'temporal-namespace': env.TEMPORAL_NAMESPACE },
              apiKey: connOpts.apiKey
            }
          : {})
      })

      const temporalClient = new Client({
        connection: clientConnection,
        namespace: env.TEMPORAL_NAMESPACE
      })

      if (env.WORKER_ENABLE_SCHEDULES) {
        // The outbox is drained by the event-driven dispatcher (Postgres NOTIFY
        // + backstop sweep), not a 5s poller schedule. Reap the legacy schedule
        // if a prior deploy left it behind, then start the listener loop.
        await deleteOutboxPollerScheduleIfExists(temporalClient)

        outboxDispatcher = startOutboxDispatcher({
          client: temporalClient,
          defaultTaskQueue: env.TEMPORAL_TASK_QUEUE,
          batchSize: env.OUTBOX_POLL_BATCH_SIZE,
          backstopIntervalSeconds: env.OUTBOX_BACKSTOP_INTERVAL_SECONDS,
          listenerDatabaseUrl: env.OUTBOX_LISTENER_DATABASE_URL
        })

        await ensureStuckEventsResetSchedule(
          temporalClient,
          env.TEMPORAL_TASK_QUEUE,
          120,
          env.OUTBOX_STUCK_THRESHOLD_MINUTES
        )

        await ensurePrunePublishedSchedule(
          temporalClient,
          env.TEMPORAL_TASK_QUEUE,
          24,
          env.OUTBOX_PRUNE_RETENTION_DAYS
        )

        await ensureRetentionCleanerSchedule(
          temporalClient,
          env.TEMPORAL_TASK_QUEUE,
          6,
          72
        )

        // @spec INV-BILLING-003 — reclaim orphaned credit reservations every
        // 10 minutes. Default max age is 7200s (2 hours), overridable via
        // `RESERVATION_RECLAIM_MAX_AGE_SECONDS`.
        await ensureReleaseStaleReservationsSchedule(
          temporalClient,
          env.TEMPORAL_TASK_QUEUE,
          10,
          env.RESERVATION_RECLAIM_MAX_AGE_SECONDS
        )

        // @spec billing-and-pricing-design §"Auto-recharge retry policy" —
        // every hour, scan for failed auto-recharge attempts whose
        // `next_retry_at` has elapsed and re-fire the trigger.
        await ensureAutoRechargeRetrySchedule(
          temporalClient,
          env.TEMPORAL_TASK_QUEUE,
          60
        )

        // @spec billing-and-pricing-design §"Monthly Storage Reconciliation" —
        // nightly at 03:00 UTC, walk every org whose storage_usage rollup
        // has rolled over and charge ongoing overage via
        // `StorageBillingService.reconcileMonthlyOverage`. Idempotent via the
        // `reconcile:<orgId>:<monthTag>` ledger reference.
        await ensureStorageReconcileSchedule(
          temporalClient,
          env.TEMPORAL_TASK_QUEUE
        )

        await ensureEmailSendsPruneSchedule(
          temporalClient,
          env.EMAIL_CAMPAIGNS_TASK_QUEUE,
          24,
          30
        )
      } else {
        logger.info('Temporal schedule reconciliation skipped.', {
          nodeEnv: env.NODE_ENV
        })
      }

      await workerRuns
      logger.info('Temporal workers stopped.', { signal: shutdownSignal })
    } finally {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      await outboxDispatcher?.stop()
      shutdownWorkerIfRunning(worker, env.TEMPORAL_TASK_QUEUE)
      shutdownWorkerIfRunning(emailCampaignWorker, env.EMAIL_CAMPAIGNS_TASK_QUEUE)
      await Promise.allSettled([
        workerRun,
        emailCampaignWorkerRun
      ])
      await clientConnection?.close()
    }
  } finally {
    try {
      await connection.close()
    } finally {
      await Promise.all([
        stopTelemetry(),
        closeRedisClients()
      ])
    }
  }
}

const runWorker = async (): Promise<void> => {
  const env = getWorkerEnv()
  await initializeWorkerSentry(env)

  process.on('unhandledRejection', (reason) => {
    captureWorkerException(reason)
    logger.error('Unhandled promise rejection in worker', {
      error: reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : { message: String(reason) }
    })
    process.exitCode = 1
  })

  process.on('uncaughtException', (error) => {
    captureWorkerException(error)
    logger.error('Uncaught exception in worker', { error: { name: error.name, message: error.message, stack: error.stack } })
    process.exitCode = 1
    setTimeout(() => { process.exit(1) }, 5000)
  })

  try {
    await run(env)
  } catch (error) {
    captureWorkerException(error)
    logger.error('Temporal worker stopped due to an unhandled error.', {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            }
          : {
              message: String(error)
            }
    })
    process.exitCode = 1
  } finally {
    await flushWorkerSentry()
  }
}

void runWorker()
