import { Client, Connection } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { activities } from './activities.js'
import {
  getWorkerEnv,
  resolveWorkerTemporalConnectionOptions,
  type WorkerEnv
} from './config/env.js'
import {
  ensureOutboxPollerSchedule,
  ensurePrunePublishedSchedule,
  ensureStuckEventsResetSchedule
} from './schedules.js'
import {
  captureWorkerException,
  flushWorkerSentry,
  initializeWorkerSentry
} from './observability/sentry.js'

const logger = createLogger('tx-agent-kit-worker')

async function run(env: WorkerEnv): Promise<void> {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url))
  const workflowJsPath = path.join(sourceDir, 'workflows.js')
  const workflowSourcePath = existsSync(workflowJsPath)
    ? workflowJsPath
    : path.join(sourceDir, 'workflows.ts')

  await startTelemetry('tx-agent-kit-worker')

  const connOpts = resolveWorkerTemporalConnectionOptions(env)

  const connection = await NativeConnection.connect(connOpts)

  try {
    const worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: workflowSourcePath,
      activities,
      shutdownGraceTime: '30s'
    })

    logger.info('Temporal worker started.', {
      runtimeMode: env.TEMPORAL_RUNTIME_MODE,
      address: env.TEMPORAL_ADDRESS,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE
    })

    let clientConnection: Connection | undefined
    try {
      clientConnection = await Connection.connect({
        address: connOpts.address,
        ...(typeof connOpts.tls === 'object'
          ? {
              tls: {
                serverNameOverride: connOpts.tls.serverNameOverride,
                serverRootCACertificate: connOpts.tls.serverRootCACertificate,
                clientCertPair: connOpts.tls.clientCertPair
              }
            }
          : connOpts.tls === true ? { tls: true } : {}),
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

      let shuttingDown = false
      let shutdownSignal = 'worker.run completed'
      const requestShutdown = (signal: string) => {
        if (shuttingDown) {
          return
        }

        shuttingDown = true
        shutdownSignal = signal
        logger.info('Stopping Temporal worker.', { signal })
        worker.shutdown()
      }

      process.once('SIGINT', () => {
        requestShutdown('SIGINT')
      })

      process.once('SIGTERM', () => {
        requestShutdown('SIGTERM')
      })

      await ensureOutboxPollerSchedule(
        temporalClient,
        env.TEMPORAL_TASK_QUEUE,
        5,
        env.OUTBOX_POLL_BATCH_SIZE
      )

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

      await worker.run()
      logger.info('Temporal worker stopped.', { signal: shutdownSignal })
    } finally {
      await clientConnection?.close()
    }
  } finally {
    await connection.close()
    await stopTelemetry()
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
    setTimeout(() => { process.exit(1) }, 5_000)
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
