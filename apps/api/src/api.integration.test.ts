import { signSessionToken } from '@tx-agent-kit/auth'
import { createDbAuthContext, createTeam, createUser, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT ?? '4100', 10)
const integrationAuthSecret = 'integration-auth-secret-12345'
process.env.AUTH_SECRET = integrationAuthSecret
const apiCwd = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: apiPort,
  authSecret: integrationAuthSecret,
  corsOrigin: 'http://localhost:3000',
  sql: {
    schemaPrefix: 'api'
  }
})

let factoryContext: ApiFactoryContext | undefined

const requestJson = async <T>(path: string, caseName: string, init?: RequestInit): Promise<{ response: Response; body: T }> => {
  const response = await fetch(`${dbAuthContext.baseUrl}${path}`, {
    ...init,
    headers: dbAuthContext.testContext.headersForCase(caseName, {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    })
  })

  const body = await response.json() as T
  return { response, body }
}

beforeAll(async () => {
  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
  factoryContext = dbAuthContext.apiFactoryContext
})

afterAll(async () => {
  await dbAuthContext.teardown()
})

describe('api integration', () => {
  it('exposes health endpoint for readiness checks', async () => {
    const startedAt = globalThis.performance.now()
    const health = await requestJson<{ status: string; timestamp: string; service: string }>(
      '/health',
      'health-endpoint'
    )
    const durationMs = globalThis.performance.now() - startedAt

    expect(health.response.status).toBe(200)
    expect(health.body.status).toBe('healthy')
    expect(health.body.service).toBe('tx-agent-kit-api')
    expect(health.body.timestamp).toBeTruthy()
    expect(durationMs).toBeLessThan(1500)
  })

  it('supports auth + workspace + tasks flow end to end', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const createdUser = await createUser(factoryContext, {
      email: 'integration-user@example.com',
      password: 'strong-pass-12345',
      name: 'Integration User'
    })

    expect(createdUser.user.email).toBe('integration-user@example.com')
    const token = createdUser.token

    const me = await requestJson<{ userId: string; email: string; roles: string[] }>('/v1/auth/me', 'auth-me', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    })

    expect(me.response.status).toBe(200)
    expect(me.body.userId).toBeTruthy()

    const workspace = await createTeam(factoryContext, {
      token,
      name: 'Integration Workspace'
    })

    expect(workspace.name).toBe('Integration Workspace')

    const createTask = await requestJson<{ id: string; title: string; workspaceId: string }>('/v1/tasks', 'create-task', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: 'First integration task',
        description: 'from integration test'
      })
    })

    expect(createTask.response.status).toBe(201)
    expect(createTask.body.title).toBe('First integration task')

    const listTasks = await requestJson<{ data: Array<{ id: string; title: string }> }>(`/v1/tasks?workspaceId=${workspace.id}`, 'list-tasks', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    })

    expect(listTasks.response.status).toBe(200)
    expect(listTasks.body.data).toHaveLength(1)
    expect(listTasks.body.data[0]?.title).toBe('First integration task')
  })

  it('rejects sign-in with invalid credentials', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    await createUser(factoryContext, {
      email: 'invalid-sign-in@example.com',
      password: 'valid-pass-12345',
      name: 'Invalid Sign In User'
    })

    const invalidSignIn = await requestJson<{ message: string }>(
      '/v1/auth/sign-in',
      'auth-sign-in-invalid-password',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'invalid-sign-in@example.com',
          password: 'wrong-pass-12345'
        })
      }
    )

    expect(invalidSignIn.response.status).toBe(401)
    expect(invalidSignIn.body.message).toContain('Invalid credentials')
  })

  it('signs in with valid credentials and returns a usable token', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const createdUser = await createUser(factoryContext, {
      email: 'valid-sign-in@example.com',
      password: 'valid-pass-12345',
      name: 'Valid Sign In User'
    })

    const signIn = await requestJson<{ token: string; user: { id: string; email: string } }>(
      '/v1/auth/sign-in',
      'auth-sign-in-success',
      {
        method: 'POST',
        body: JSON.stringify({
          email: createdUser.user.email,
          password: 'valid-pass-12345'
        })
      }
    )

    expect(signIn.response.status).toBe(200)
    expect(signIn.body.token).toBeTruthy()
    expect(signIn.body.user.email).toBe(createdUser.user.email)

    const me = await requestJson<{ userId: string; email: string }>(
      '/v1/auth/me',
      'auth-sign-in-success-me',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${signIn.body.token}`
        }
      }
    )

    expect(me.response.status).toBe(200)
    expect(me.body.userId).toBe(createdUser.user.id)
    expect(me.body.email).toBe(createdUser.user.email)
  })

  it('signs up users and rejects duplicate emails', async () => {
    const signUp = await requestJson<{ token: string; user: { id: string; email: string } }>(
      '/v1/auth/sign-up',
      'auth-sign-up-success',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'signup-flow@example.com',
          password: 'signup-pass-12345',
          name: 'Signup Flow'
        })
      }
    )

    expect(signUp.response.status).toBe(201)
    expect(signUp.body.token.length).toBeGreaterThan(0)
    expect(signUp.body.user.email).toBe('signup-flow@example.com')

    const me = await requestJson<{ userId: string; email: string }>(
      '/v1/auth/me',
      'auth-sign-up-me',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${signUp.body.token}`
        }
      }
    )

    expect(me.response.status).toBe(200)
    expect(me.body.email).toBe('signup-flow@example.com')

    const duplicateSignUp = await requestJson<{ message: string }>(
      '/v1/auth/sign-up',
      'auth-sign-up-duplicate',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'signup-flow@example.com',
          password: 'signup-pass-12345',
          name: 'Signup Flow Duplicate'
        })
      }
    )

    expect(duplicateSignUp.response.status).toBe(409)
    expect(duplicateSignUp.body.message.length).toBeGreaterThan(0)
  })

  it('forbids task operations for users outside workspace membership', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'tasks-owner@example.com',
      password: 'owner-pass-12345',
      name: 'Tasks Owner'
    })

    const outsider = await createUser(factoryContext, {
      email: 'tasks-outsider@example.com',
      password: 'outsider-pass-12345',
      name: 'Tasks Outsider'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Task Authz Workspace'
    })

    const outsiderCreateTask = await requestJson<{ message: string }>(
      '/v1/tasks',
      'outsider-create-task-forbidden',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${outsider.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          title: 'Should not be created',
          description: 'forbidden path'
        })
      }
    )

    expect(outsiderCreateTask.response.status).toBe(401)

    const outsiderListTasks = await requestJson<{ message: string }>(
      `/v1/tasks?workspaceId=${workspace.id}`,
      'outsider-list-task-forbidden',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${outsider.token}`
        }
      }
    )

    expect(outsiderListTasks.response.status).toBe(401)
  })

  it('paginates task lists with stable cursor sorting and filters', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'task-pagination-owner@example.com',
      password: 'owner-pass-12345',
      name: 'Task Pagination Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Task Pagination Workspace'
    })

    const collaborator = await createUser(factoryContext, {
      email: 'task-pagination-collaborator@example.com',
      password: 'collaborator-pass-12345',
      name: 'Task Pagination Collaborator'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO workspace_members (workspace_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (workspace_id, user_id) DO NOTHING
        `,
        [workspace.id, collaborator.user.id]
      )
    })

    const createdTasks: Array<{ id: string; title: string }> = []
    for (const [index, title] of ['Charlie', 'Alpha', 'Bravo'].entries()) {
      const createTask = await requestJson<{ id: string; title: string }>(
        '/v1/tasks',
        `create-task-pagination-${index + 1}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${owner.token}`
          },
          body: JSON.stringify({
            workspaceId: workspace.id,
            title,
            description: `task-${index + 1}`
          })
        }
      )

      expect(createTask.response.status).toBe(201)
      createdTasks.push(createTask.body)
    }

    const collaboratorTask = await requestJson<{ id: string; title: string; createdByUserId: string }>(
      '/v1/tasks',
      'create-task-pagination-collaborator',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${collaborator.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          title: 'Delta',
          description: 'task-collaborator'
        })
      }
    )

    expect(collaboratorTask.response.status).toBe(201)
    expect(collaboratorTask.body.createdByUserId).toBe(collaborator.user.id)

    const alphaTask = createdTasks.find((task) => task.title === 'Alpha')
    if (!alphaTask) {
      throw new Error('Expected Alpha task to exist')
    }

    const updateAlpha = await requestJson<{ id: string; status: string }>(
      `/v1/tasks/${alphaTask.id}`,
      'update-alpha-task-status',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          status: 'done'
        })
      }
    )

    expect(updateAlpha.response.status).toBe(200)
    expect(updateAlpha.body.status).toBe('done')

    const firstPage = await requestJson<{
      data: Array<{ id: string; title: string; status: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      `/v1/tasks?workspaceId=${workspace.id}&limit=2&sortBy=title&sortOrder=asc`,
      'list-task-pagination-page-1',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(firstPage.response.status).toBe(200)
    expect(firstPage.body.total).toBe(4)
    expect(firstPage.body.prevCursor).toBeNull()
    expect(firstPage.body.nextCursor).toBeTruthy()
    expect(firstPage.body.data.map((task) => task.title)).toEqual(['Alpha', 'Bravo'])

    const nextCursor = firstPage.body.nextCursor
    if (!nextCursor) {
      throw new Error('Expected next cursor on first page')
    }

    const secondPage = await requestJson<{
      data: Array<{ id: string; title: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      `/v1/tasks?workspaceId=${workspace.id}&limit=2&sortBy=title&sortOrder=asc&cursor=${encodeURIComponent(nextCursor)}`,
      'list-task-pagination-page-2',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(secondPage.response.status).toBe(200)
    expect(secondPage.body.total).toBe(4)
    expect(secondPage.body.nextCursor).toBeNull()
    expect(secondPage.body.prevCursor).toBeTruthy()
    expect(secondPage.body.data.map((task) => task.title)).toEqual(['Charlie', 'Delta'])

    const doneOnly = await requestJson<{
      data: Array<{ id: string; title: string; status: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      `/v1/tasks?workspaceId=${workspace.id}&filter[status]=done`,
      'list-task-pagination-filter-status',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(doneOnly.response.status).toBe(200)
    expect(doneOnly.body.total).toBe(1)
    expect(doneOnly.body.data).toHaveLength(1)
    expect(doneOnly.body.data[0]?.id).toBe(alphaTask.id)
    expect(doneOnly.body.data[0]?.status).toBe('done')

    const byCollaborator = await requestJson<{
      data: Array<{ id: string; createdByUserId: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      `/v1/tasks?workspaceId=${workspace.id}&filter[createdByUserId]=${collaborator.user.id}`,
      'list-task-pagination-filter-created-by',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(byCollaborator.response.status).toBe(200)
    expect(byCollaborator.body.total).toBe(1)
    expect(byCollaborator.body.data[0]?.id).toBe(collaboratorTask.body.id)
    expect(byCollaborator.body.data[0]?.createdByUserId).toBe(collaborator.user.id)
  })

  it('returns bad request for invalid list query params', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'invalid-query-owner@example.com',
      password: 'owner-pass-12345',
      name: 'Invalid Query Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invalid Query Workspace'
    })

    const invalidCases = [
      {
        path: `/v1/tasks?workspaceId=${workspace.id}&limit=0`,
        caseName: 'invalid-query-tasks-limit'
      },
      {
        path: `/v1/tasks?workspaceId=${workspace.id}&sortOrder=up`,
        caseName: 'invalid-query-tasks-sort-order'
      },
      {
        path: `/v1/tasks?workspaceId=${workspace.id}&sortBy=unknown`,
        caseName: 'invalid-query-tasks-sort-by'
      },
      {
        path: '/v1/workspaces?sortBy=unknown',
        caseName: 'invalid-query-workspaces-sort-by'
      },
      {
        path: '/v1/invitations?sortBy=unknown',
        caseName: 'invalid-query-invitations-sort-by'
      }
    ] as const

    for (const testCase of invalidCases) {
      const invalidResponse = await requestJson<{ message: string }>(
        testCase.path,
        testCase.caseName,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${owner.token}`
          }
        }
      )

      if (invalidResponse.response.status !== 400) {
        throw new Error(
          `Expected 400 for ${testCase.caseName}, received ${invalidResponse.response.status}`
        )
      }
      expect(invalidResponse.body.message.length).toBeGreaterThan(0)
    }
  })

  it('paginates workspace lists with name sorting and cursors', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'workspace-pagination-owner@example.com',
      password: 'owner-pass-12345',
      name: 'Workspace Pagination Owner'
    })

    for (const [index, name] of ['Charlie Workspace', 'Alpha Workspace', 'Bravo Workspace'].entries()) {
      const created = await requestJson<{ id: string; name: string }>(
        '/v1/workspaces',
        `create-workspace-pagination-${index + 1}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${owner.token}`
          },
          body: JSON.stringify({ name })
        }
      )

      expect(created.response.status).toBe(201)
    }

    const firstPage = await requestJson<{
      data: Array<{ id: string; name: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/workspaces?limit=2&sortBy=name&sortOrder=asc',
      'list-workspaces-pagination-page-1',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(firstPage.response.status).toBe(200)
    expect(firstPage.body.total).toBe(3)
    expect(firstPage.body.data.map((workspace) => workspace.name)).toEqual([
      'Alpha Workspace',
      'Bravo Workspace'
    ])
    expect(firstPage.body.prevCursor).toBeNull()
    expect(firstPage.body.nextCursor).toBeTruthy()

    const nextCursor = firstPage.body.nextCursor
    if (!nextCursor) {
      throw new Error('Expected next cursor for workspace page')
    }

    const secondPage = await requestJson<{
      data: Array<{ id: string; name: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      `/v1/workspaces?limit=2&sortBy=name&sortOrder=asc&cursor=${encodeURIComponent(nextCursor)}`,
      'list-workspaces-pagination-page-2',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(secondPage.response.status).toBe(200)
    expect(secondPage.body.total).toBe(3)
    expect(secondPage.body.data.map((workspace) => workspace.name)).toEqual(['Charlie Workspace'])
    expect(secondPage.body.prevCursor).toBeTruthy()
  })

  it('supports batch get-many endpoints for admin data providers', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'batch-owner@example.com',
      password: 'owner-pass-12345',
      name: 'Batch Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: 'batch-invitee@example.com',
      password: 'invitee-pass-12345',
      name: 'Batch Invitee'
    })

    const outsideOwner = await createUser(factoryContext, {
      email: 'batch-outside-owner@example.com',
      password: 'outside-owner-pass-12345',
      name: 'Batch Outside Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Batch Workspace'
    })

    const outsideWorkspace = await createTeam(factoryContext, {
      token: outsideOwner.token,
      name: 'Outside Workspace'
    })

    const task = await requestJson<{ id: string }>(
      '/v1/tasks',
      'batch-create-task',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          title: 'Batch Task',
          description: 'batch test task'
        })
      }
    )

    expect(task.response.status).toBe(201)

    const outsideTask = await requestJson<{ id: string }>(
      '/v1/tasks',
      'batch-create-outside-task',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${outsideOwner.token}`
        },
        body: JSON.stringify({
          workspaceId: outsideWorkspace.id,
          title: 'Outside Task',
          description: 'outside workspace task'
        })
      }
    )

    expect(outsideTask.response.status).toBe(201)

    const invitation = await requestJson<{ id: string }>(
      '/v1/invitations',
      'batch-create-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(invitation.response.status).toBe(201)

    const outsideInvitation = await requestJson<{ id: string }>(
      '/v1/invitations',
      'batch-create-outside-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${outsideOwner.token}`
        },
        body: JSON.stringify({
          workspaceId: outsideWorkspace.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(outsideInvitation.response.status).toBe(201)

    const batchWorkspaces = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/workspaces/batch/get-many',
      'batch-get-many-workspaces',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: [outsideWorkspace.id, workspace.id]
        })
      }
    )

    expect(batchWorkspaces.response.status).toBe(200)
    expect(batchWorkspaces.body.data.map((item) => item.id)).toEqual([workspace.id])

    const batchTasks = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/tasks/batch/get-many',
      'batch-get-many-tasks',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: [outsideTask.body.id, randomUUID(), task.body.id]
        })
      }
    )

    expect(batchTasks.response.status).toBe(200)
    expect(batchTasks.body.data.map((item) => item.id)).toEqual([task.body.id])

    const batchInvitations = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/invitations/batch/get-many',
      'batch-get-many-invitations',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: [outsideInvitation.body.id, invitation.body.id]
        })
      }
    )

    expect(batchInvitations.response.status).toBe(200)
    expect(batchInvitations.body.data.map((item) => item.id)).toEqual([invitation.body.id])

    const invalidWorkspaceBatchBody = await requestJson<{ message: string }>(
      '/v1/workspaces/batch/get-many',
      'batch-get-many-invalid-uuid-workspaces',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: ['not-a-uuid']
        })
      }
    )

    expect(invalidWorkspaceBatchBody.response.status).toBe(400)
    expect(invalidWorkspaceBatchBody.body.message.length).toBeGreaterThan(0)

    const invalidTaskBatchBody = await requestJson<{ message: string }>(
      '/v1/tasks/batch/get-many',
      'batch-get-many-invalid-uuid-tasks',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: ['not-a-uuid']
        })
      }
    )

    expect(invalidTaskBatchBody.response.status).toBe(400)
    expect(invalidTaskBatchBody.body.message.length).toBeGreaterThan(0)

    const invalidInvitationBatchBody = await requestJson<{ message: string }>(
      '/v1/invitations/batch/get-many',
      'batch-get-many-invalid-uuid-invitations',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: ['not-a-uuid']
        })
      }
    )

    expect(invalidInvitationBatchBody.response.status).toBe(400)
    expect(invalidInvitationBatchBody.body.message.length).toBeGreaterThan(0)
  })

  it('supports detail, update, and delete lifecycle endpoints for workspace, task, and invitation', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'crud-lifecycle-owner@example.com',
      password: 'owner-pass-12345',
      name: 'CRUD Lifecycle Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: 'crud-lifecycle-invitee@example.com',
      password: 'invitee-pass-12345',
      name: 'CRUD Lifecycle Invitee'
    })

    const createdWorkspace = await requestJson<{ id: string; name: string; ownerUserId: string }>(
      '/v1/workspaces',
      'crud-lifecycle-create-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'CRUD Lifecycle Workspace'
        })
      }
    )

    expect(createdWorkspace.response.status).toBe(201)

    const workspaceId = createdWorkspace.body.id

    const workspaceById = await requestJson<{ id: string; name: string; ownerUserId: string }>(
      `/v1/workspaces/${workspaceId}`,
      'crud-lifecycle-get-workspace',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(workspaceById.response.status).toBe(200)
    expect(workspaceById.body.id).toBe(workspaceId)
    expect(workspaceById.body.ownerUserId).toBe(owner.user.id)

    const updatedWorkspace = await requestJson<{ id: string; name: string }>(
      `/v1/workspaces/${workspaceId}`,
      'crud-lifecycle-update-workspace',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'CRUD Lifecycle Workspace Updated'
        })
      }
    )

    expect(updatedWorkspace.response.status).toBe(200)
    expect(updatedWorkspace.body.name).toBe('CRUD Lifecycle Workspace Updated')

    const createdTask = await requestJson<{
      id: string
      workspaceId: string
      title: string
      description: string | null
      status: 'todo' | 'in_progress' | 'done'
    }>(
      '/v1/tasks',
      'crud-lifecycle-create-task',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId,
          title: 'CRUD Lifecycle Task',
          description: 'task description'
        })
      }
    )

    expect(createdTask.response.status).toBe(201)

    const taskId = createdTask.body.id

    const taskById = await requestJson<{
      id: string
      workspaceId: string
      title: string
      description: string | null
      status: 'todo' | 'in_progress' | 'done'
    }>(
      `/v1/tasks/${taskId}`,
      'crud-lifecycle-get-task',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(taskById.response.status).toBe(200)
    expect(taskById.body.id).toBe(taskId)
    expect(taskById.body.workspaceId).toBe(workspaceId)
    expect(taskById.body.status).toBe('todo')

    const updatedTask = await requestJson<{
      id: string
      title: string
      description: string | null
      status: 'todo' | 'in_progress' | 'done'
    }>(
      `/v1/tasks/${taskId}`,
      'crud-lifecycle-update-task',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          title: 'CRUD Lifecycle Task Updated',
          description: null,
          status: 'done'
        })
      }
    )

    expect(updatedTask.response.status).toBe(200)
    expect(updatedTask.body.title).toBe('CRUD Lifecycle Task Updated')
    expect(updatedTask.body.description).toBeNull()
    expect(updatedTask.body.status).toBe('done')

    const createdInvitation = await requestJson<{
      id: string
      workspaceId: string
      email: string
      role: 'admin' | 'member'
      status: 'pending' | 'accepted' | 'revoked' | 'expired'
    }>(
      '/v1/invitations',
      'crud-lifecycle-create-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const invitationId = createdInvitation.body.id

    const invitationById = await requestJson<{
      id: string
      workspaceId: string
      role: 'admin' | 'member'
      status: 'pending' | 'accepted' | 'revoked' | 'expired'
    }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-get-invitation',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invitationById.response.status).toBe(200)
    expect(invitationById.body.id).toBe(invitationId)
    expect(invitationById.body.workspaceId).toBe(workspaceId)
    expect(invitationById.body.status).toBe('pending')

    const updatedInvitation = await requestJson<{
      id: string
      role: 'admin' | 'member'
      status: 'pending' | 'accepted' | 'revoked' | 'expired'
    }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-update-invitation',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          role: 'admin',
          status: 'revoked'
        })
      }
    )

    expect(updatedInvitation.response.status).toBe(200)
    expect(updatedInvitation.body.role).toBe('admin')
    expect(updatedInvitation.body.status).toBe('revoked')

    const removedInvitation = await requestJson<{ deleted: boolean }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-remove-invitation',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removedInvitation.response.status).toBe(200)
    expect(removedInvitation.body.deleted).toBe(true)

    const invitationAfterRemove = await requestJson<{ id: string; status: string }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-get-invitation-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invitationAfterRemove.response.status).toBe(200)
    expect(invitationAfterRemove.body.id).toBe(invitationId)
    expect(invitationAfterRemove.body.status).toBe('revoked')

    const removedTask = await requestJson<{ deleted: boolean }>(
      `/v1/tasks/${taskId}`,
      'crud-lifecycle-remove-task',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removedTask.response.status).toBe(200)
    expect(removedTask.body.deleted).toBe(true)

    const taskAfterRemove = await requestJson<{ message: string }>(
      `/v1/tasks/${taskId}`,
      'crud-lifecycle-get-task-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(taskAfterRemove.response.status).toBe(404)

    const removedWorkspace = await requestJson<{ deleted: boolean }>(
      `/v1/workspaces/${workspaceId}`,
      'crud-lifecycle-remove-workspace',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removedWorkspace.response.status).toBe(200)
    expect(removedWorkspace.body.deleted).toBe(true)

    const workspaceAfterRemove = await requestJson<{ message: string }>(
      `/v1/workspaces/${workspaceId}`,
      'crud-lifecycle-get-workspace-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(workspaceAfterRemove.response.status).toBe(404)
  })

  it('auto-creates owner membership when workspace is created via API', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'workspace-owner-trigger@example.com',
      password: 'owner-pass-12345',
      name: 'Workspace Trigger Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Workspace Trigger Team'
    })

    const membershipResult = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      client.query<{ role: string }>(
        `
          SELECT role
          FROM workspace_members
          WHERE workspace_id = $1
            AND user_id = $2
          LIMIT 1
        `,
        [workspace.id, owner.user.id]
      )
    )

    expect(membershipResult.rows).toHaveLength(1)
    expect(membershipResult.rows[0]?.role).toBe('owner')
  })

  it('lists invitations for invitee email and not workspace membership', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'owner@example.com',
      password: 'strong-pass-12345',
      name: 'Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee@example.com',
      password: 'strong-pass-12345',
      name: 'Invitee'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invite Scope Workspace'
    })

    const createdInvitation = await requestJson<{ id: string; token: string; email: string }>(
      '/v1/invitations',
      'create-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const ownerInvitations = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/invitations',
      'list-owner-invitations',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(ownerInvitations.response.status).toBe(200)
    expect(ownerInvitations.body.data).toHaveLength(0)

    const inviteeInvitations = await requestJson<{ data: Array<{ id: string; token: string; email: string }> }>(
      '/v1/invitations',
      'list-invitee-invitations',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(inviteeInvitations.response.status).toBe(200)
    expect(inviteeInvitations.body.data).toHaveLength(1)
    expect(inviteeInvitations.body.data[0]?.id).toBe(createdInvitation.body.id)
    expect(inviteeInvitations.body.data[0]?.token).toBe(createdInvitation.body.token)
    expect(inviteeInvitations.body.data[0]?.email).toBe(invitee.user.email)
  })

  it('supports invitation list filtering and expiresAt sorting', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'owner-invite-filter@example.com',
      password: 'owner-pass-12345',
      name: 'Owner Invite Filter'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee-invite-filter@example.com',
      password: 'invitee-pass-12345',
      name: 'Invitee Invite Filter'
    })

    const workspaceOne = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invite Filter Workspace One'
    })

    const workspaceTwo = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invite Filter Workspace Two'
    })

    const memberInvitation = await requestJson<{ id: string }>(
      '/v1/invitations',
      'create-invitation-filter-member',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspaceOne.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    const adminInvitation = await requestJson<{ id: string }>(
      '/v1/invitations',
      'create-invitation-filter-admin',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspaceTwo.id,
          email: invitee.user.email,
          role: 'admin'
        })
      }
    )

    expect(memberInvitation.response.status).toBe(201)
    expect(adminInvitation.response.status).toBe(201)

    const revokeAdminInvitation = await requestJson<{ id: string; status: string }>(
      `/v1/invitations/${adminInvitation.body.id}`,
      'update-invitation-filter-admin-revoked',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          status: 'revoked'
        })
      }
    )

    expect(revokeAdminInvitation.response.status).toBe(200)
    expect(revokeAdminInvitation.body.status).toBe('revoked')

    const roleFiltered = await requestJson<{
      data: Array<{ id: string; role: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/invitations?filter[role]=admin',
      'list-invitations-filter-role-admin',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(roleFiltered.response.status).toBe(200)
    expect(roleFiltered.body.total).toBe(1)
    expect(roleFiltered.body.data[0]?.id).toBe(adminInvitation.body.id)

    const statusFiltered = await requestJson<{
      data: Array<{ id: string; status: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/invitations?filter[status]=revoked',
      'list-invitations-filter-status-revoked',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(statusFiltered.response.status).toBe(200)
    expect(statusFiltered.body.total).toBe(1)
    expect(statusFiltered.body.data[0]?.id).toBe(adminInvitation.body.id)
    expect(statusFiltered.body.data[0]?.status).toBe('revoked')

    const sortedByExpiresAt = await requestJson<{
      data: Array<{ id: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/invitations?sortBy=expiresAt&sortOrder=asc',
      'list-invitations-sort-expires-at',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(sortedByExpiresAt.response.status).toBe(200)
    expect(sortedByExpiresAt.body.total).toBe(2)
    expect(sortedByExpiresAt.body.data).toHaveLength(2)
  })

  it('requires admin privileges for invites and only allows inviting existing users', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'owner-roles@example.com',
      password: 'strong-pass-12345',
      name: 'Owner Roles'
    })

    const member = await createUser(factoryContext, {
      email: 'member-roles@example.com',
      password: 'strong-pass-12345',
      name: 'Member Roles'
    })

    const target = await createUser(factoryContext, {
      email: 'target-roles@example.com',
      password: 'strong-pass-12345',
      name: 'Target Roles'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Role Guard Workspace'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO workspace_members (workspace_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (workspace_id, user_id) DO NOTHING
        `,
        [workspace.id, member.user.id]
      )
    })

    const memberInviteAttempt = await requestJson<{ message: string }>(
      '/v1/invitations',
      'member-create-invitation-forbidden',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          email: target.user.email,
          role: 'member'
        })
      }
    )

    expect(memberInviteAttempt.response.status).toBe(401)

    const ownerMissingUserInvite = await requestJson<{ message: string }>(
      '/v1/invitations',
      'owner-create-invitation-missing-user',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          email: 'not-registered@example.com',
          role: 'member'
        })
      }
    )

    expect(ownerMissingUserInvite.response.status).toBe(400)
    expect(ownerMissingUserInvite.body.message).toContain('already have an account')
  })

  it('uses canonical user identity for invitation listing and acceptance', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'owner-identity@example.com',
      password: 'strong-pass-12345',
      name: 'Owner Identity'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee-identity@example.com',
      password: 'strong-pass-12345',
      name: 'Invitee Identity'
    })

    const attacker = await createUser(factoryContext, {
      email: 'attacker-identity@example.com',
      password: 'strong-pass-12345',
      name: 'Attacker Identity'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Identity Guard Workspace'
    })

    const createdInvitation = await requestJson<{ id: string; token: string }>(
      '/v1/invitations',
      'create-identity-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)
    const invitationToken = createdInvitation.body.token

    const forgedToken = await Effect.runPromise(
      signSessionToken({
        sub: attacker.user.id,
        email: invitee.user.email
      })
    )

    const forgedList = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/invitations',
      'list-invitations-forged-token',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${forgedToken}`
        }
      }
    )

    expect(forgedList.response.status).toBe(200)
    expect(forgedList.body.data).toHaveLength(0)

    const forgedAccept = await requestJson<{ message?: string }>(
      `/v1/invitations/${invitationToken}/accept`,
      'accept-invitation-forged-token',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${forgedToken}`
        }
      }
    )

    expect(forgedAccept.response.status).toBe(404)

    const inviteeAccept = await requestJson<{ accepted: boolean }>(
      `/v1/invitations/${invitationToken}/accept`,
      'accept-invitation-real-invitee',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(inviteeAccept.response.status).toBe(200)
    expect(inviteeAccept.body.accepted).toBe(true)
  })

  it('accepts invitations idempotently and grants workspace access once', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'owner-idempotent@example.com',
      password: 'owner-pass-12345',
      name: 'Owner Idempotent'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee-idempotent@example.com',
      password: 'invitee-pass-12345',
      name: 'Invitee Idempotent'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Idempotent Invitation Workspace'
    })

    const createdInvitation = await requestJson<{ token: string }>(
      '/v1/invitations',
      'create-idempotent-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          workspaceId: workspace.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const firstAccept = await requestJson<{ accepted: boolean }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-idempotent-invitation-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(firstAccept.response.status).toBe(200)
    expect(firstAccept.body.accepted).toBe(true)

    const secondAccept = await requestJson<{ message: string }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-idempotent-invitation-second',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(secondAccept.response.status).toBe(404)

    const inviteeWorkspaces = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/workspaces',
      'list-workspaces-after-accept',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(inviteeWorkspaces.response.status).toBe(200)
    expect(inviteeWorkspaces.body.data.some((item) => item.id === workspace.id)).toBe(true)
  })

  it('prevents deleting a user who still owns workspaces', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'delete-owner@example.com',
      password: 'strong-pass-12345',
      name: 'Delete Owner'
    })

    await createTeam(factoryContext, {
      token: owner.token,
      name: 'Owner Delete Guard Workspace'
    })

    const deleteResponse = await requestJson<{ message: string }>(
      '/v1/auth/me',
      'delete-owner-with-workspace',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(deleteResponse.response.status).toBe(409)
    expect(deleteResponse.body.message).toContain('Transfer ownership first')
  })

  it('invalidates deleted-user tokens immediately', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'delete-token@example.com',
      password: 'strong-pass-12345',
      name: 'Delete Token User'
    })

    const deleteResponse = await requestJson<{ deleted: boolean }>(
      '/v1/auth/me',
      'delete-user-without-workspace',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${user.token}`
        }
      }
    )

    expect(deleteResponse.response.status).toBe(200)
    expect(deleteResponse.body.deleted).toBe(true)

    const meAfterDelete = await requestJson<{ message: string }>(
      '/v1/auth/me',
      'auth-me-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${user.token}`
        }
      }
    )

    expect(meAfterDelete.response.status).toBe(401)
  })
})
