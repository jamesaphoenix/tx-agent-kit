import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import type { activities as WorkerActivities } from './activities.js'
import {
  getWorkerEnv,
  resolveWorkerTemporalConnectionOptions
} from './config/env.js'

let activitiesRef: typeof WorkerActivities | undefined
let temporalConnection: NativeConnection | undefined
let workflowClient: Client | undefined
let workflowWorker: Worker | undefined
let workflowWorkerRunPromise: Promise<void> | undefined
let workflowTaskQueue: string | undefined

interface PingWorkflowResult {
  readonly ok: boolean
}

beforeAll(async () => {
  const [{ activities }] = await Promise.all([
    import('./activities.js')
  ])

  activitiesRef = activities
  const workerEnv = getWorkerEnv()

  temporalConnection = await NativeConnection.connect(
    resolveWorkerTemporalConnectionOptions(workerEnv)
  )
  workflowClient = new Client({
    connection: temporalConnection,
    namespace: workerEnv.TEMPORAL_NAMESPACE
  })

  workflowTaskQueue = `tx-agent-kit-worker-integration-${randomUUID()}`
  const sourceDir = dirname(fileURLToPath(import.meta.url))

  workflowWorker = await Worker.create({
    connection: temporalConnection,
    namespace: workerEnv.TEMPORAL_NAMESPACE,
    taskQueue: workflowTaskQueue,
    workflowsPath: resolve(sourceDir, 'workflows.ts'),
    activities
  })
  workflowWorkerRunPromise = workflowWorker.run()
})

afterAll(async () => {
  if (workflowWorker) {
    workflowWorker.shutdown()
  }
  if (workflowWorkerRunPromise) {
    await workflowWorkerRunPromise
  }
  if (temporalConnection) {
    await temporalConnection.close()
  }
})

const getActivities = (): typeof WorkerActivities => {
  if (!activitiesRef) {
    throw new Error('Worker activities were not initialized')
  }

  return activitiesRef
}

const getWorkflowClient = (): Client => {
  if (!workflowClient) {
    throw new Error('Workflow client was not initialized')
  }

  return workflowClient
}

const parsePingWorkflowResult = (value: unknown): PingWorkflowResult => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Workflow result must be an object')
  }

  const record = value as Record<string, unknown>
  if (typeof record.ok !== 'boolean') {
    throw new Error('Workflow result.ok must be a boolean')
  }

  return { ok: record.ok }
}

describe('worker activities integration', () => {
  it('executes ping activity directly', async () => {
    const activities = getActivities()
    const result = await activities.ping()

    expect(result).toEqual({ ok: true })
  })

  it('executes pingWorkflow end to end', async () => {
    if (!workflowTaskQueue) {
      throw new Error('Workflow task queue was not initialized')
    }

    const client = getWorkflowClient()
    const handle = await client.workflow.start('pingWorkflow', {
      taskQueue: workflowTaskQueue,
      workflowId: `ping-${randomUUID()}`,
      args: []
    })
    const result = parsePingWorkflowResult(await handle.result())

    expect(result.ok).toBe(true)
  }, 120_000)
})
