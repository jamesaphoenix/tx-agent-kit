import { signSessionToken } from '@tx-agent-kit/auth'
import { createDbAuthContext, createTeam, createUser, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
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

    const listTasks = await requestJson<{ tasks: Array<{ id: string; title: string }> }>(`/v1/tasks?workspaceId=${workspace.id}`, 'list-tasks', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    })

    expect(listTasks.response.status).toBe(200)
    expect(listTasks.body.tasks).toHaveLength(1)
    expect(listTasks.body.tasks[0]?.title).toBe('First integration task')
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

    const ownerInvitations = await requestJson<{ invitations: Array<{ id: string }> }>(
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
    expect(ownerInvitations.body.invitations).toHaveLength(0)

    const inviteeInvitations = await requestJson<{ invitations: Array<{ id: string; token: string; email: string }> }>(
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
    expect(inviteeInvitations.body.invitations).toHaveLength(1)
    expect(inviteeInvitations.body.invitations[0]?.id).toBe(createdInvitation.body.id)
    expect(inviteeInvitations.body.invitations[0]?.token).toBe(createdInvitation.body.token)
    expect(inviteeInvitations.body.invitations[0]?.email).toBe(invitee.user.email)
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

    const forgedList = await requestJson<{ invitations: Array<{ id: string }> }>(
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
    expect(forgedList.body.invitations).toHaveLength(0)

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

    const inviteeWorkspaces = await requestJson<{ workspaces: Array<{ id: string }> }>(
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
    expect(inviteeWorkspaces.body.workspaces.some((item) => item.id === workspace.id)).toBe(true)
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
