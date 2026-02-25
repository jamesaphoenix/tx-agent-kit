import { NativeConnection, Worker } from '@temporalio/worker'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { activities } from './activities.js'
import { getWorkerEnv, resolveWorkerTemporalConnectionOptions } from './config/env.js'

const logger = createLogger('tx-agent-kit-worker')

async function run(): Promise<void> {
  const env = getWorkerEnv()
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

void run()
