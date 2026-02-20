import { NativeConnection, Worker } from '@temporalio/worker'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { activities } from './activities.js'

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

  const shutdown = async () => {
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
