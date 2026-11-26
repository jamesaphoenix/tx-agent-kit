import { Client, Connection } from '@temporalio/client'
import { NativeConnection, Worker, type WorkerOptions } from '@temporalio/worker'
import { ActivityErrorBoundaryInterceptor } from './activity-error-boundary.js'
import { setPoolErrorReporter } from '@tx-agent-kit/db'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { closeRedisClients, setRedisErrorReporter } from '@tx-agent-kit/redis'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
import {
  ensureEmailSendsPruneSchedule,
  ensureDripSweepSchedule,
  ensureLifecycleScanSchedule
} from './schedules/index.js'
import { syncCampaignDefinitions } from './campaign-definition-sync.js'
import {
  reconcileUntilComplete,
  retryWithBackoff,
  RetryAbortedError,
  type ReconcileStep
} from './retry-backoff.js'
import {
  BACKGROUND_RECONCILE_RETRY,
  isTransientTemporalError,
  TEMPORAL_STARTUP_RETRY,
  WORKER_EXIT_BACKSTOP_MS,
  WORKER_EXIT_FLUSH_TIMEOUT_MS
} from './worker-resilience-policy.js'
import {
  firstWorkerToStop,
  resolveWorkerExitCode,
  settleWorkerRuns,
  type SupervisedWorkerRun,
  type WorkerRunOutcome
} from './worker-supervisor.js'
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

// Queue-scoped pidfile so a fresh worker boot (or `kill-stale-service.sh worker`)
// can reap a previous worker that is still polling the SAME Temporal task queue.
// This prevents worker version skew when multiple checkouts share a queue: only
// the prior holder of this exact queue is killed, never workers on a different
// queue (isolated worktrees or unrelated projects). Dev-only convenience.
const workerPidfilePath = (taskQueue: string): string =>
  path.join(tmpdir(), `tx-agent-worker.${taskQueue.replaceAll(/[^A-Za-z0-9_.-]/g, '_')}.pid`)

const writeWorkerPidfile = (taskQueue: string): string => {
  const file = workerPidfilePath(taskQueue)
  try {
    writeFileSync(file, String(process.pid))
  } catch {
    // Best-effort: the pidfile is only a local stale-killer convenience.
  }
  return file
}

const removeWorkerPidfile = (file: string): void => {
  try {
    rmSync(file, { force: true })
  } catch {
    // Best-effort cleanup; a stale pidfile is guarded against on the read side.
  }
}

const scheduleStep = (name: string, run: () => Promise<unknown>): ReconcileStep => ({
  name,
  run: async () => {
    await run()
  }
})

/**
 * Every schedule this worker owns (plus the campaign definition sync), as
 * idempotent reconciliation steps. They run in the background after the
 * workers are polling (see startBackgroundReconciliation), so a slow or
 * unreachable Temporal can delay them but can never stop the workers.
 */
const buildScheduleReconcileSteps = (
  temporalClient: Client,
  env: WorkerEnv
): ReadonlyArray<ReconcileStep> => [
  // The outbox is drained by the event-driven dispatcher (Postgres NOTIFY +
  // backstop sweep), not a 5s poller schedule. Reap the legacy schedule if a
  // prior deploy left it behind.
  scheduleStep('legacy-outbox-poller-schedule-delete', () => deleteOutboxPollerScheduleIfExists(temporalClient)),

  scheduleStep('stuck-events-reset-schedule', () => ensureStuckEventsResetSchedule(
    temporalClient,
    env.TEMPORAL_TASK_QUEUE,
    120,
    env.OUTBOX_STUCK_THRESHOLD_MINUTES
  )),

  scheduleStep('prune-published-schedule', () => ensurePrunePublishedSchedule(
    temporalClient,
    env.TEMPORAL_TASK_QUEUE,
    24,
    env.OUTBOX_PRUNE_RETENTION_DAYS
  )),

  scheduleStep('retention-cleaner-schedule', () => ensureRetentionCleanerSchedule(
    temporalClient,
    env.TEMPORAL_TASK_QUEUE,
    6,
    72
  )),

  // @spec INV-BILLING-003 — reclaim orphaned credit reservations every
  // 10 minutes. Default max age is 7200s (2 hours), overridable via
  // `RESERVATION_RECLAIM_MAX_AGE_SECONDS`.
  scheduleStep('release-stale-reservations-schedule', () => ensureReleaseStaleReservationsSchedule(
    temporalClient,
    env.TEMPORAL_TASK_QUEUE,
    10,
    env.RESERVATION_RECLAIM_MAX_AGE_SECONDS
  )),

  // @spec billing-and-pricing-design §"Auto-recharge retry policy" —
  // every hour, scan for failed auto-recharge attempts whose
  // `next_retry_at` has elapsed and re-fire the trigger.
  scheduleStep('auto-recharge-retry-schedule', () => ensureAutoRechargeRetrySchedule(
    temporalClient,
    env.TEMPORAL_TASK_QUEUE,
    60
  )),

  // @spec billing-and-pricing-design §"Monthly Storage Reconciliation" —
  // nightly at 03:00 UTC, walk every org whose storage_usage rollup
  // has rolled over and charge ongoing overage via
  // `StorageBillingService.reconcileMonthlyOverage`. Idempotent via the
  // `reconcile:<orgId>:<monthTag>` ledger reference.
  scheduleStep('storage-reconcile-schedule', () => ensureStorageReconcileSchedule(
    temporalClient,
    env.TEMPORAL_TASK_QUEUE
  )),

  scheduleStep('email-sends-prune-schedule', () => ensureEmailSendsPruneSchedule(
    temporalClient,
    env.EMAIL_CAMPAIGNS_TASK_QUEUE,
    24,
    30
  )),

  // Converge the email_campaigns tables to config-as-code campaign
  // definitions (slug-keyed upsert) before the sweep schedule starts
  // claiming due enrollments, so a fresh DB has its lifecycle campaigns.
  // On a pass where the sync fails the sweep step still runs; the sweep only
  // claims enrollments that exist, and the sync is retried on the next pass.
  scheduleStep('campaign-definitions-sync', () => syncCampaignDefinitions()),

  // The drip SWEEP: drains the due-enrollment queue every interval on the
  // email-campaigns queue (where campaignActivities + dripSweepWorkflow run).
  scheduleStep('drip-sweep-schedule', () => ensureDripSweepSchedule(
    temporalClient,
    env.EMAIL_CAMPAIGNS_TASK_QUEUE,
    env.DRIP_SWEEP_INTERVAL_MINUTES,
    env.DRIP_SWEEP_BATCH_SIZE,
    env.DRIP_SWEEP_MAX_BATCHES
  )),

  // The daily per-team activity scan runs on the DEFAULT queue (where
  // scanTeamActivity + lifecycleScanWorkflow are registered).
  scheduleStep('lifecycle-scan-schedule', () => ensureLifecycleScanSchedule(
    temporalClient,
    env.TEMPORAL_TASK_QUEUE,
    env.LIFECYCLE_SCAN_INTERVAL_HOURS
  ))
]

interface BackgroundReconciliation {
  /** Abort retries, stop the outbox dispatcher, close the schedule client and wait for the task. */
  readonly stop: () => Promise<void>
}

/**
 * Work that needs Temporal (or the database) but must never block or stop the
 * workers: the schedule client connection, the outbox dispatcher (which needs
 * that client), schedule reconciliation and the campaign definition sync.
 * Everything retries with backoff until it succeeds or the worker shuts down.
 *
 * Without this, a schedule describe that timed out with DEADLINE_EXCEEDED
 * while Temporal was overloaded crashed the boot, so the container
 * restart-looped (and raised a Sentry issue each time) instead of polling.
 */
const startBackgroundReconciliation = (input: {
  readonly env: WorkerEnv
  readonly connectScheduleClient: () => Promise<Connection>
}): BackgroundReconciliation => {
  const { env } = input
  const controller = new AbortController()
  const { signal } = controller
  let clientConnection: Connection | undefined
  let outboxDispatcher: OutboxDispatcherHandle | null = null

  const retryOptions = {
    policy: BACKGROUND_RECONCILE_RETRY.policy,
    escalateAfterMs: BACKGROUND_RECONCILE_RETRY.escalateAfterMs,
    // One Sentry event when a failure has lasted long enough to need a human,
    // not one per retry.
    onEscalate: captureWorkerException,
    signal,
    logger
  }

  const runInBackground = async (label: string, task: () => Promise<void>): Promise<void> => {
    try {
      await task()
    } catch (error: unknown) {
      if (error instanceof RetryAbortedError) {
        logger.info(`${label} stopped because the worker is shutting down.`)
        return
      }
      // Retries here have no time limit, so this is a programming error, not an outage.
      captureWorkerException(error)
      logger.error(`${label} stopped unexpectedly.`, { error: toErrorLogContext(error) })
    }
  }

  const scheduleReconciliation = env.WORKER_ENABLE_SCHEDULES
    ? runInBackground('Temporal schedule reconciliation', async () => {
        const connection = await retryWithBackoff(
          () => input.connectScheduleClient(),
          { ...retryOptions, label: 'Temporal schedule client connection' }
        )
        if (signal.aborted) {
          await connection.close()
          throw new RetryAbortedError('Temporal schedule client connection')
        }
        clientConnection = connection

        const temporalClient = new Client({
          connection,
          namespace: env.TEMPORAL_NAMESPACE
        })

        // The outbox dispatcher is the live data path, so it starts as soon as
        // a client exists rather than waiting for every schedule to reconcile.
        outboxDispatcher = startOutboxDispatcher({
          client: temporalClient,
          defaultTaskQueue: env.TEMPORAL_TASK_QUEUE,
          emailCampaignsTaskQueue: env.EMAIL_CAMPAIGNS_TASK_QUEUE,
          batchSize: env.OUTBOX_POLL_BATCH_SIZE,
          backstopIntervalSeconds: env.OUTBOX_BACKSTOP_INTERVAL_SECONDS,
          listenerDatabaseUrl: env.OUTBOX_LISTENER_DATABASE_URL
        })

        const steps = buildScheduleReconcileSteps(temporalClient, env)
        await reconcileUntilComplete(steps, { ...retryOptions, label: 'Temporal schedule reconciliation' })
        logger.info('Temporal schedule reconciliation complete.', { steps: steps.length })
      })
    : (() => {
        logger.info('Temporal schedule reconciliation skipped.', {
          nodeEnv: env.NODE_ENV
        })
        return Promise.resolve()
      })()

  return {
    stop: async () => {
      controller.abort()
      try {
        await outboxDispatcher?.stop()
      } finally {
        // Closing the client also fails any schedule call still in flight, so
        // the background task settles promptly.
        await clientConnection?.close()
        await scheduleReconciliation
      }
    }
  }
}

const describeWorkerStop = (outcome: WorkerRunOutcome): Record<string, unknown> =>
  outcome.kind === 'failed'
    ? { taskQueue: outcome.taskQueue, outcome: 'failed', error: toErrorLogContext(outcome.error) }
    : { taskQueue: outcome.taskQueue, outcome: 'stopped' }

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

  // Register this worker in a queue-scoped pidfile so the next boot (via
  // kill-stale-service.sh) reaps a stale worker still polling the same task
  // queue, preventing Temporal worker version skew across checkouts.
  const workerPidfile = writeWorkerPidfile(env.TEMPORAL_TASK_QUEUE)
  process.once('exit', () => { removeWorkerPidfile(workerPidfile) })

  startTelemetry('tx-agent-kit-worker')

  // Centralized activity error boundary: logs + Sentry-captures every activity
  // failure once (parity with the API's mapCoreError boundary), then re-throws
  // unchanged so Temporal retry semantics are untouched. Registered as an
  // activity inbound interceptor over all run sites.
  const activityInterceptors = [
    () => ({ inbound: new ActivityErrorBoundaryInterceptor() })
  ]

  const connOpts = resolveWorkerTemporalConnectionOptions(env)
  const testPollerOptions = env.NODE_ENV === 'test'
    ? {
        maxConcurrentWorkflowTaskPolls: 1,
        maxConcurrentActivityTaskPolls: 1
      }
    : {}

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

  // One budget for the whole boot: connect, describe the namespace, create
  // both workers. A Temporal outage is waited out here (see
  // TEMPORAL_STARTUP_RETRY) instead of crash-looping the container.
  const startupRetry = {
    policy: TEMPORAL_STARTUP_RETRY.policy,
    escalateAfterMs: TEMPORAL_STARTUP_RETRY.escalateAfterMs,
    maxElapsedMs: TEMPORAL_STARTUP_RETRY.maxElapsedMs,
    startedAtMs: Date.now(),
    logger
  }

  let connection: NativeConnection | undefined
  try {
    // The namespace probe is cheap; Worker.create re-bundles the workflow code
    // on every attempt, so it only runs once the namespace answers.
    const nativeConnection = await retryWithBackoff(async () => {
      connection ??= await NativeConnection.connect(connOpts)
      await connection.workflowService.describeNamespace({ namespace: env.TEMPORAL_NAMESPACE })
      return connection
    }, { ...startupRetry, label: 'Temporal startup (connect and describe namespace)' })

    // A bundle or configuration error fails the same way every time, so only
    // Temporal-side failures are retried here.
    const createWorker = (options: WorkerOptions): Promise<Worker> =>
      retryWithBackoff(
        () => Worker.create(options),
        {
          ...startupRetry,
          label: `Temporal worker creation (${options.taskQueue})`,
          isRetryable: isTransientTemporalError
        }
      )

    const worker = await createWorker({
      connection: nativeConnection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: workflowSourcePath,
      activities: combinedActivities,
      interceptors: { activity: activityInterceptors },
      shutdownGraceTime: '30s',
      ...testPollerOptions
    })

    const emailCampaignWorker = await createWorker({
      connection: nativeConnection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.EMAIL_CAMPAIGNS_TASK_QUEUE,
      workflowsPath: campaignWorkflowSourcePath,
      activities: campaignActivities,
      interceptors: { activity: activityInterceptors },
      shutdownGraceTime: '30s',
      ...testPollerOptions
    })

    const workerRuns: ReadonlyArray<SupervisedWorkerRun> = [
      { taskQueue: env.TEMPORAL_TASK_QUEUE, run: worker.run() },
      { taskQueue: env.EMAIL_CAMPAIGNS_TASK_QUEUE, run: emailCampaignWorker.run() }
    ]
    const shutdownAllWorkers = () => {
      shutdownWorkerIfRunning(worker, env.TEMPORAL_TASK_QUEUE)
      shutdownWorkerIfRunning(emailCampaignWorker, env.EMAIL_CAMPAIGNS_TASK_QUEUE)
    }

    let shutdownSignal: string | null = null
    // Read through a function: the signal handlers set `shutdownSignal` during
    // the awaits below, which control-flow narrowing cannot see.
    const requestedShutdownSignal = (): string | null => shutdownSignal
    const requestShutdown = (signal: string) => {
      if (shutdownSignal !== null) {
        return
      }

      shutdownSignal = signal
      logger.info('Stopping Temporal workers.', { signal })
      shutdownAllWorkers()
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

    const background = startBackgroundReconciliation({
      env,
      connectScheduleClient: () => Connection.connect({
        address: connOpts.address,
        ...tlsConfig,
        ...(connOpts.apiKey
          ? {
              metadata: { 'temporal-namespace': env.TEMPORAL_NAMESPACE },
              apiKey: connOpts.apiKey
            }
          : {})
      })
    })

    try {
      // The process is healthy only while BOTH workers poll. The first one to
      // stop, for whatever reason, ends the run loop.
      const firstStop = await firstWorkerToStop(workerRuns)
      armExitBackstop()
      if (requestedShutdownSignal() === null) {
        logger.warn('A Temporal worker stopped without a shutdown request; stopping the other worker so the process can be restarted.', describeWorkerStop(firstStop))
      }
      shutdownAllWorkers()

      const outcomes = await settleWorkerRuns(workerRuns)
      logger.info('Temporal workers stopped.', {
        signal: requestedShutdownSignal() ?? 'none',
        workers: outcomes.map(describeWorkerStop)
      })

      if (resolveWorkerExitCode(outcomes, requestedShutdownSignal() !== null) !== 0) {
        const failure = firstStop.kind === 'failed'
          ? firstStop
          : outcomes.find((outcome) => outcome.kind === 'failed')
        if (failure?.kind === 'failed') {
          throw failure.error
        }
        throw new Error(`Temporal worker for task queue ${firstStop.taskQueue} stopped without a shutdown request.`)
      }
    } finally {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      await background.stop()
      shutdownAllWorkers()
      await Promise.allSettled(workerRuns.map(({ run: workerRun }) => workerRun))
    }
  } finally {
    // From here the process is on its way out: make sure cleanup that hangs
    // (for example closing a connection to an unreachable server) cannot keep
    // it alive.
    armExitBackstop()
    try {
      await connection?.close()
    } finally {
      await Promise.all([
        stopTelemetry(),
        closeRedisClients()
      ])
    }
  }
}

/**
 * Once the run loop has ended the process must actually exit, even if cleanup
 * hangs (a worker that logged it had stopped but stayed alive with nothing
 * polling would never be restarted by Docker).
 */
let exitBackstop: ReturnType<typeof setTimeout> | undefined

const armExitBackstop = (): void => {
  if (exitBackstop !== undefined) {
    return
  }
  exitBackstop = setTimeout(() => {
    logger.error('Temporal worker shutdown did not finish in time; forcing exit.', {
      timeoutMs: WORKER_EXIT_BACKSTOP_MS
    })
    process.exit(1)
  }, WORKER_EXIT_BACKSTOP_MS)
  exitBackstop.unref()
}

const exitWorkerProcess = (code: number): void => {
  if (exitBackstop !== undefined) {
    clearTimeout(exitBackstop)
    exitBackstop = undefined
  }
  process.exit(code)
}

// Last-resort handler for genuinely unexpected process-level faults. We do NOT
// swallow these: after an arbitrary uncaught error the process state is undefined,
// so limping on risks corrupt work. Instead we capture to Sentry, flush, and exit
// cleanly so Docker `restart: unless-stopped` brings the worker back in a
// known-good state. Benign, recoverable infra errors (idle pg pool / ioredis
// socket drops) are consumed at their source via
// setPoolErrorReporter/setRedisErrorReporter and never reach here.
const FATAL_FLUSH_BACKSTOP_MS = 5000
let fatalShutdownInitiated = false

const handleFatalError = (error: unknown, message: string): void => {
  captureWorkerException(error)
  logger.error(message, {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) }
  })

  if (fatalShutdownInitiated) {
    return
  }
  fatalShutdownInitiated = true
  process.exitCode = 1

  // Force-exit on a backstop timer in case the flush ever hangs.
  const backstop = setTimeout(() => {
    process.exit(1)
  }, FATAL_FLUSH_BACKSTOP_MS)
  backstop.unref()

  // Flush Sentry BEFORE exiting so the crash event is not lost, then exit so
  // Docker `restart: unless-stopped` brings the worker back in a known-good state.
  void (async () => {
    try {
      await flushWorkerSentry()
    } finally {
      process.exit(1)
    }
  })()
}

const runWorker = async (): Promise<void> => {
  const env = getWorkerEnv()
  await initializeWorkerSentry(env)

  // Route long-lived background EventEmitter 'error' events (raw pg pool, cached
  // ioredis sockets) to Sentry. Without these listeners a benign idle-connection
  // drop escalates to an uncaughtException and crashes the worker.
  setPoolErrorReporter(captureWorkerException)
  setRedisErrorReporter(captureWorkerException)

  process.on('unhandledRejection', (reason) => {
    handleFatalError(reason, 'Unhandled promise rejection in worker')
  })

  process.on('uncaughtException', (error) => {
    handleFatalError(error, 'Uncaught exception in worker')
  })

  let exitCode = 0
  try {
    await run(env)
  } catch (error) {
    armExitBackstop()
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
    exitCode = 1
    process.exitCode = 1
  } finally {
    armExitBackstop()
    await flushBeforeExit(WORKER_EXIT_FLUSH_TIMEOUT_MS)
    // Exit explicitly: native Temporal handles or telemetry exporters can
    // keep the event loop alive after every worker has stopped, which leaves
    // a process that looks "Up" to Docker but polls nothing. Setting
    // process.exitCode alone is not enough.
    exitWorkerProcess(exitCode)
  }
}

/**
 * Flush Sentry before exiting, bounded by `timeoutMs`. A flush that rejects or
 * never settles (an unreachable endpoint) is logged and abandoned rather than
 * allowed to hold the exit.
 */
const flushBeforeExit = async (timeoutMs: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const flushed = (async (): Promise<true> => {
    try {
      await flushWorkerSentry()
    } catch {
      // A failed flush must not stop the exit; Sentry already lost the event.
    }
    return true
  })()
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, timeoutMs)
    timer.unref()
  })
  try {
    if (!(await Promise.race([flushed, timedOut]))) {
      logger.warn('Worker exit flush did not finish in time; exiting without waiting for it.', { timeoutMs })
    }
  } finally {
    clearTimeout(timer)
  }
}

void runWorker()
