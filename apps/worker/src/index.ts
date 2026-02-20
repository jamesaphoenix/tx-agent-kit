import { NativeConnection, Worker } from '@temporalio/worker'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { activities } from './activities.js'

const logger = createLogger('tx-agent-kit-worker')

async function run(): Promise<void> {
  await startTelemetry('tx-agent-kit-worker')

  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233'
  })

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'tx-agent-kit',
    workflowsPath: path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows.js'),
    activities
  })

  logger.info('Temporal worker started.', {
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'tx-agent-kit'
  })

  const shutdown = async () => {
    logger.info('Stopping Temporal worker.')
    await stopTelemetry()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown()
  })

  process.on('SIGTERM', () => {
    void shutdown()
  })

  await worker.run()
}

void run()
