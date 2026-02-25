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

  const connection = await NativeConnection.connect(
    resolveWorkerTemporalConnectionOptions(env)
  )

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: workflowSourcePath,
    activities
  })

  logger.info('Temporal worker started.', {
    runtimeMode: env.TEMPORAL_RUNTIME_MODE,
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE
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

  process.on('SIGINT', () => {
    requestShutdown('SIGINT')
  })

  process.on('SIGTERM', () => {
    requestShutdown('SIGTERM')
  })

  try {
    await worker.run()
    logger.info('Temporal worker stopped.', { signal: shutdownSignal })
  } finally {
    await connection.close()
    await stopTelemetry()
  }
}

const runWorker = async (): Promise<void> => {
  const env = getWorkerEnv()
  await initializeWorkerSentry(env)

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
