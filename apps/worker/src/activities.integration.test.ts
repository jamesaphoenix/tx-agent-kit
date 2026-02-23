import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { getPool as GetDbPool } from '@tx-agent-kit/db'
import type { activities as WorkerActivities } from './activities.js'

let activitiesRef: typeof WorkerActivities | undefined
let getPoolRef: typeof GetDbPool | undefined

const seedTask = async (): Promise<{ workspaceId: string; taskId: string }> => {
  if (!getPoolRef) {
    throw new Error('DB pool is not initialized')
  }

  const client = await getPoolRef().connect()
  try {
    const ownerUserId = randomUUID()
    const workspaceId = randomUUID()
    const taskId = randomUUID()

    await client.query(
      `
        INSERT INTO users (id, email, password_hash, name)
        VALUES ($1, $2, 'hash', 'Worker Integration Owner')
      `,
      [ownerUserId, `worker-owner-${ownerUserId}@example.com`]
    )

    await client.query(
      `
        INSERT INTO workspaces (id, name, owner_user_id)
        VALUES ($1, 'Worker Integration Workspace', $2)
      `,
      [workspaceId, ownerUserId]
    )

    await client.query(
      `
        INSERT INTO tasks (id, workspace_id, title, description, status, created_by_user_id)
        VALUES ($1, $2, 'Worker Integration Task', 'task for worker integration flow', 'todo', $3)
      `,
      [taskId, workspaceId, ownerUserId]
    )

    return { workspaceId, taskId }
  } finally {
    client.release()
  }
}

beforeAll(async () => {
  const [{ activities }, dbModule] = await Promise.all([
    import('./activities.js'),
    import('@tx-agent-kit/db')
  ])

  activitiesRef = activities
  getPoolRef = dbModule.getPool
})

afterAll(async () => {
  try {
    if (getPoolRef) {
      await getPoolRef().end()
    }
  } catch {
    // Pool may not be initialized in failing/short-circuit paths.
  }
})

const getActivities = (): typeof WorkerActivities => {
  if (!activitiesRef) {
    throw new Error('Worker activities were not initialized')
  }

  return activitiesRef
}

describe('worker activities integration', () => {
  it('marks duplicated operation ids as already processed', async () => {
    const { workspaceId, taskId } = await seedTask()
    const operationId = randomUUID()

    const activities = getActivities()
    const first = await activities.processTask({ operationId, workspaceId, taskId })
    const second = await activities.processTask({ operationId, workspaceId, taskId })

    expect(first).toEqual({
      operationId,
      alreadyProcessed: false
    })
    expect(second).toEqual({
      operationId,
      alreadyProcessed: true
    })
  })

  it('allows distinct operation ids for the same task', async () => {
    const { workspaceId, taskId } = await seedTask()

    const activities = getActivities()
    const first = await activities.processTask({
      operationId: randomUUID(),
      workspaceId,
      taskId
    })
    const second = await activities.processTask({
      operationId: randomUUID(),
      workspaceId,
      taskId
    })

    expect(first.alreadyProcessed).toBe(false)
    expect(second.alreadyProcessed).toBe(false)
  })
})
