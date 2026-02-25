import { signSessionToken } from '@tx-agent-kit/auth'
import { createDbAuthContext, createTeam, createUser, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT ?? '4100', 10)
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const healthReadinessLatencyBudgetMs = parsePositiveInt(
  process.env.API_HEALTH_READINESS_MAX_LATENCY_MS,
 1_500
)
const healthBurstRequestCount = parsePositiveInt(
  process.env.API_HEALTH_BURST_REQUEST_COUNT,
  20
)
const healthBurstLatencyBudgetMs = parsePositiveInt(
  process.env.API_HEALTH_BURST_MAX_LATENCY_MS,
  20_000
)
const authRateLimitWindowMs = parsePositiveInt(
  process.env.API_AUTH_RATE_LIMIT_WINDOW_MS,
  60_000
)
const authRateLimitMaxRequests = parsePositiveInt(
  process.env.API_AUTH_RATE_LIMIT_MAX_REQUESTS,
  15
)
const integrationAuthSecret = 'integration-auth-secret-12345'
process.env.AUTH_SECRET = integrationAuthSecret
process.env.AUTH_RATE_LIMIT_WINDOW_MS = String(authRateLimitWindowMs)
process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = String(authRateLimitMaxRequests)
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
    expect(durationMs).toBeLessThan(healthReadinessLatencyBudgetMs)
  })

  it('serves concurrent health checks successfully within burst budget', async () => {
    const startedAt = globalThis.performance.now()

    const healthResponses = await Promise.all(
      Array.from({ length: healthBurstRequestCount }, (_, index) =>
        requestJson<{ status: string; service: string }>(
          '/health',
          `health-endpoint-burst-${index}`
        )
      )
    )

    const durationMs = globalThis.performance.now() - startedAt

    for (const health of healthResponses) {
      expect(health.response.status).toBe(200)
      expect(health.body.status).toBe('healthy')
      expect(health.body.service).toBe('tx-agent-kit-api')
    }
    expect(durationMs).toBeLessThan(healthBurstLatencyBudgetMs)
  })

  it('supports auth + organization flow end to end', async () => {
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

    const organization = await createTeam(factoryContext, {
      token,
      name: 'Integration Organization'
    })

    expect(organization.name).toBe('Integration Organization')

    const listOrganizations = await requestJson<{ data: Array<{ id: string; name: string }> }>('/v1/organizations', 'list-organizations', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    })

    expect(listOrganizations.response.status).toBe(200)
    expect(listOrganizations.body.data).toHaveLength(1)
    expect(listOrganizations.body.data[0]?.name).toBe('Integration Organization')
  })

  it('rejects protected organization routes without auth token', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const listOrganizationsWithoutToken = await requestJson<{ message: string }>(
      '/v1/organizations',
      'unauthorized-list-organizations',
      {
        method: 'GET'
      }
    )

    expect(listOrganizationsWithoutToken.response.status).toBe(401)
  })

  it('rejects auth profile lookups without auth token', async () => {
    const meWithoutToken = await requestJson<{ message: string }>(
      '/v1/auth/me',
      'unauthorized-auth-me',
      {
        method: 'GET'
      }
    )

    expect(meWithoutToken.response.status).toBe(401)
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

  it('returns deterministic conflict for concurrent duplicate sign-up attempts', async () => {
    const signupEmail = 'concurrent-signup@example.com'

    const [attemptOne, attemptTwo] = await Promise.all([
      requestJson<{ token?: string; user?: { email: string }; message?: string }>(
        '/v1/auth/sign-up',
        'auth-sign-up-concurrent-attempt-1',
        {
          method: 'POST',
          body: JSON.stringify({
            email: signupEmail,
            password: 'signup-pass-12345',
            name: 'Concurrent Signup One'
          })
        }
      ),
      requestJson<{ token?: string; user?: { email: string }; message?: string }>(
        '/v1/auth/sign-up',
        'auth-sign-up-concurrent-attempt-2',
        {
          method: 'POST',
          body: JSON.stringify({
            email: signupEmail.toUpperCase(),
            password: 'signup-pass-12345',
            name: 'Concurrent Signup Two'
          })
        }
      )
    ])

    const statuses = [attemptOne.response.status, attemptTwo.response.status].sort((a, b) => a - b)
    expect(statuses).toEqual([201, 409])

    const conflictAttempt = [attemptOne, attemptTwo].find((attempt) => attempt.response.status === 409)
    if (!conflictAttempt) {
      throw new Error('Expected one concurrent sign-up attempt to return conflict')
    }

    expect(conflictAttempt.body.message).toContain('Email is already in use')

    const signIn = await requestJson<{ token: string }>(
      '/v1/auth/sign-in',
      'auth-sign-up-concurrent-sign-in',
      {
        method: 'POST',
        body: JSON.stringify({
          email: signupEmail,
          password: 'signup-pass-12345'
        })
      }
    )

    expect(signIn.response.status).toBe(200)
    expect(signIn.body.token.length).toBeGreaterThan(0)
  })

  it('handles forgot-password requests without account enumeration', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const existingUser = await createUser(factoryContext, {
      email: 'forgot-password-existing@example.com',
      password: 'forgot-existing-pass-12345',
      name: 'Forgot Existing User'
    })

    const existingForgot = await requestJson<{ accepted: boolean }>(
      '/v1/auth/forgot-password',
      'auth-forgot-password-existing',
      {
        method: 'POST',
        body: JSON.stringify({
          email: existingUser.user.email
        })
      }
    )

    const existingForgotAgain = await requestJson<{ accepted: boolean }>(
      '/v1/auth/forgot-password',
      'auth-forgot-password-existing-again',
      {
        method: 'POST',
        body: JSON.stringify({
          email: existingUser.user.email
        })
      }
    )

    const missingForgot = await requestJson<{ accepted: boolean }>(
      '/v1/auth/forgot-password',
      'auth-forgot-password-missing',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'missing-user-forgot-password@example.com'
        })
      }
    )

    expect(existingForgot.response.status).toBe(202)
    expect(existingForgot.body.accepted).toBe(true)
    expect(existingForgotAgain.response.status).toBe(202)
    expect(existingForgotAgain.body.accepted).toBe(true)
    expect(missingForgot.response.status).toBe(202)
    expect(missingForgot.body.accepted).toBe(true)

    const resetTokenCounts = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        existingCount: string
        existingActiveCount: string
        existingUsedCount: string
        totalCount: string
      }>(
        `
          SELECT
            COUNT(*) FILTER (WHERE user_id = $1)::text AS "existingCount",
            COUNT(*) FILTER (WHERE user_id = $1 AND used_at IS NULL AND expires_at > now())::text AS "existingActiveCount",
            COUNT(*) FILTER (WHERE user_id = $1 AND used_at IS NOT NULL)::text AS "existingUsedCount",
            COUNT(*)::text AS "totalCount"
          FROM password_reset_tokens
        `,
        [existingUser.user.id]
      )

      const row = result.rows[0]
      return {
        existingCount: Number.parseInt(row?.existingCount ?? '0', 10),
        existingActiveCount: Number.parseInt(row?.existingActiveCount ?? '0', 10),
        existingUsedCount: Number.parseInt(row?.existingUsedCount ?? '0', 10),
        totalCount: Number.parseInt(row?.totalCount ?? '0', 10)
      }
    })

    expect(resetTokenCounts.existingCount).toBe(2)
    expect(resetTokenCounts.existingActiveCount).toBe(1)
    expect(resetTokenCounts.existingUsedCount).toBe(1)
    expect(resetTokenCounts.totalCount).toBe(2)
  })

  it('resets passwords with one-time tokens', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'reset-password-user@example.com',
      password: 'reset-password-old-12345',
      name: 'Reset Password User'
    })

    const rawToken = 'integration-reset-token'
    const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex')

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES ($1, $2, now() + interval '30 minutes')
        `,
        [user.user.id, tokenHash]
      )
    })

    const reset = await requestJson<{ reset: boolean }>(
      '/v1/auth/reset-password',
      'auth-reset-password-success',
      {
        method: 'POST',
        body: JSON.stringify({
          token: rawToken,
          password: 'reset-password-new-12345'
        })
      }
    )

    expect(reset.response.status).toBe(200)
    expect(reset.body.reset).toBe(true)

    const meWithPreResetToken = await requestJson<{ message: string }>(
      '/v1/auth/me',
      'auth-reset-password-old-token',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${user.token}`
        }
      }
    )

    expect(meWithPreResetToken.response.status).toBe(401)

    const oldPasswordSignIn = await requestJson<{ message: string }>(
      '/v1/auth/sign-in',
      'auth-reset-password-old-password',
      {
        method: 'POST',
        body: JSON.stringify({
          email: user.user.email,
          password: 'reset-password-old-12345'
        })
      }
    )

    expect(oldPasswordSignIn.response.status).toBe(401)

    const newPasswordSignIn = await requestJson<{ token: string }>(
      '/v1/auth/sign-in',
      'auth-reset-password-new-password',
      {
        method: 'POST',
        body: JSON.stringify({
          email: user.user.email,
          password: 'reset-password-new-12345'
        })
      }
    )

    expect(newPasswordSignIn.response.status).toBe(200)
    expect(newPasswordSignIn.body.token.length).toBeGreaterThan(0)

    const reusedToken = await requestJson<{ message: string }>(
      '/v1/auth/reset-password',
      'auth-reset-password-reused-token',
      {
        method: 'POST',
        body: JSON.stringify({
          token: rawToken,
          password: 'reset-password-another-12345'
        })
      }
    )

    expect(reusedToken.response.status).toBe(400)
    expect(reusedToken.body.message).toContain('Invalid or expired')
  })

  it('rejects expired password reset tokens', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'expired-reset-password-user@example.com',
      password: 'expired-reset-password-old-12345',
      name: 'Expired Reset Password User'
    })

    const rawToken = 'integration-expired-reset-token'
    const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex')

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES ($1, $2, now() + interval '30 minutes')
        `,
        [user.user.id, tokenHash]
      )

      await client.query(
        `
          UPDATE password_reset_tokens
          SET expires_at = now() - interval '1 minute'
          WHERE token_hash = $1
        `,
        [tokenHash]
      )
    })

    const reset = await requestJson<{ message: string }>(
      '/v1/auth/reset-password',
      'auth-reset-password-expired-token',
      {
        method: 'POST',
        body: JSON.stringify({
          token: rawToken,
          password: 'expired-reset-password-new-12345'
        })
      }
    )

    expect(reset.response.status).toBe(400)
    expect(reset.body.message).toContain('Invalid or expired')

    const oldPasswordSignIn = await requestJson<{ token: string }>(
      '/v1/auth/sign-in',
      'auth-reset-password-expired-token-old-password',
      {
        method: 'POST',
        body: JSON.stringify({
          email: user.user.email,
          password: 'expired-reset-password-old-12345'
        })
      }
    )

    expect(oldPasswordSignIn.response.status).toBe(200)
    expect(oldPasswordSignIn.body.token.length).toBeGreaterThan(0)
  })

  it('forbids organization mutation for non-owner members', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'organization-mutation-owner@example.com',
      password: 'owner-pass-12345',
      name: 'Organization Mutation Owner'
    })

    const member = await createUser(factoryContext, {
      email: 'organization-mutation-member@example.com',
      password: 'member-pass-12345',
      name: 'Organization Mutation Member'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Organization Mutation Team'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (organization_id, user_id) DO NOTHING
        `,
        [organization.id, member.user.id]
      )
    })

    const memberUpdateOrganization = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}`,
      'member-update-organization-forbidden',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          name: 'Member Should Not Rename'
        })
      }
    )

    expect([401, 403]).toContain(memberUpdateOrganization.response.status)

    const memberDeleteOrganization = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}`,
      'member-delete-organization-forbidden',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )

    expect([401, 403]).toContain(memberDeleteOrganization.response.status)
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

    const invalidCases = [
      {
        path: '/v1/organizations?sortBy=unknown',
        caseName: 'invalid-query-organizations-sort-by'
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

  it('paginates organization lists with name sorting and cursors', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'organization-pagination-owner@example.com',
      password: 'owner-pass-12345',
      name: 'Organization Pagination Owner'
    })

    for (const [index, name] of ['Charlie Organization', 'Alpha Organization', 'Bravo Organization'].entries()) {
      const created = await requestJson<{ id: string; name: string }>(
        '/v1/organizations',
        `create-organization-pagination-${index + 1}`,
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
      '/v1/organizations?limit=2&sortBy=name&sortOrder=asc',
      'list-organizations-pagination-page-1',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(firstPage.response.status).toBe(200)
    expect(firstPage.body.total).toBe(3)
    expect(firstPage.body.data.map((org) => org.name)).toEqual([
      'Alpha Organization',
      'Bravo Organization'
    ])
    expect(firstPage.body.prevCursor).toBeNull()
    expect(firstPage.body.nextCursor).toBeTruthy()

    const nextCursor = firstPage.body.nextCursor
    if (!nextCursor) {
      throw new Error('Expected next cursor for organization page')
    }

    const secondPage = await requestJson<{
      data: Array<{ id: string; name: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      `/v1/organizations?limit=2&sortBy=name&sortOrder=asc&cursor=${encodeURIComponent(nextCursor)}`,
      'list-organizations-pagination-page-2',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(secondPage.response.status).toBe(200)
    expect(secondPage.body.total).toBe(3)
    expect(secondPage.body.data.map((org) => org.name)).toEqual(['Charlie Organization'])
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

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Batch Organization'
    })

    const outsideOrganization = await createTeam(factoryContext, {
      token: outsideOwner.token,
      name: 'Outside Organization'
    })

    const invitation = await requestJson<{ id: string }>(
      '/v1/invitations',
      'batch-create-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
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
          organizationId: outsideOrganization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(outsideInvitation.response.status).toBe(201)

    const batchOrganizations = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/organizations/batch/get-many',
      'batch-get-many-organizations',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: [outsideOrganization.id, organization.id]
        })
      }
    )

    expect(batchOrganizations.response.status).toBe(200)
    expect(batchOrganizations.body.data.map((item) => item.id)).toEqual([organization.id])

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

    const invalidOrganizationBatchBody = await requestJson<{ message: string }>(
      '/v1/organizations/batch/get-many',
      'batch-get-many-invalid-uuid-organizations',
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

    expect(invalidOrganizationBatchBody.response.status).toBe(400)
    expect(invalidOrganizationBatchBody.body.message.length).toBeGreaterThan(0)

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

  it('supports detail, update, and delete lifecycle endpoints for organization and invitation', async () => {
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

    const createdOrganization = await requestJson<{ id: string; name: string }>(
      '/v1/organizations',
      'crud-lifecycle-create-organization',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'CRUD Lifecycle Organization'
        })
      }
    )

    expect(createdOrganization.response.status).toBe(201)

    const organizationId = createdOrganization.body.id

    const organizationById = await requestJson<{ id: string; name: string }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-get-organization',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(organizationById.response.status).toBe(200)
    expect(organizationById.body.id).toBe(organizationId)

    const updatedOrganization = await requestJson<{ id: string; name: string }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-update-organization',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'CRUD Lifecycle Organization Updated'
        })
      }
    )

    expect(updatedOrganization.response.status).toBe(200)
    expect(updatedOrganization.body.name).toBe('CRUD Lifecycle Organization Updated')

    const createdInvitation = await requestJson<{
      id: string
      organizationId: string
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
          organizationId,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const invitationId = createdInvitation.body.id

    const invitationById = await requestJson<{
      id: string
      organizationId: string
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
    expect(invitationById.body.organizationId).toBe(organizationId)
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

    const removedOrganization = await requestJson<{ deleted: boolean }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-remove-organization',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removedOrganization.response.status).toBe(200)
    expect(removedOrganization.body.deleted).toBe(true)

    const organizationAfterRemove = await requestJson<{ message: string }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-get-organization-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(organizationAfterRemove.response.status).toBe(404)
  })

  it('auto-creates owner membership when organization is created via API', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'organization-owner-trigger@example.com',
      password: 'owner-pass-12345',
      name: 'Organization Trigger Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Organization Trigger Team'
    })

    const membershipResult = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      client.query<{ role: string }>(
        `
          SELECT role
          FROM org_members
          WHERE organization_id = $1
            AND user_id = $2
          LIMIT 1
        `,
        [organization.id, owner.user.id]
      )
    )

    expect(membershipResult.rows).toHaveLength(1)
    expect(membershipResult.rows[0]?.role).toBe('owner')
  })

  it('lists invitations for invitee email and not organization membership', async () => {
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

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invite Scope Organization'
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
          organizationId: organization.id,
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

    const organizationOne = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invite Filter Organization One'
    })

    const organizationTwo = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invite Filter Organization Two'
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
          organizationId: organizationOne.id,
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
          organizationId: organizationTwo.id,
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

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Role Guard Organization'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (organization_id, user_id) DO NOTHING
        `,
        [organization.id, member.user.id]
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
          organizationId: organization.id,
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
          organizationId: organization.id,
          email: 'not-registered@example.com',
          role: 'member'
        })
      }
    )

    expect(ownerMissingUserInvite.response.status).toBe(400)
    expect(ownerMissingUserInvite.body.message).toContain('already have an account')
  })

  it('rejects invitations for users who are already organization members', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'owner-member-conflict@example.com',
      password: 'strong-pass-12345',
      name: 'Owner Member Conflict'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee-member-conflict@example.com',
      password: 'strong-pass-12345',
      name: 'Invitee Member Conflict'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invite Member Conflict Organization'
    })

    const firstInvite = await requestJson<{ token: string }>(
      '/v1/invitations',
      'create-invitation-member-conflict-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(firstInvite.response.status).toBe(201)

    const acceptInvite = await requestJson<{ accepted: boolean }>(
      `/v1/invitations/${firstInvite.body.token}/accept`,
      'accept-invitation-member-conflict-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(acceptInvite.response.status).toBe(200)
    expect(acceptInvite.body.accepted).toBe(true)

    const duplicateInvite = await requestJson<{ message: string }>(
      '/v1/invitations',
      'create-invitation-member-conflict-duplicate',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(duplicateInvite.response.status).toBe(409)
    expect(duplicateInvite.body.message).toContain('already an organization member')
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

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Identity Guard Organization'
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
          organizationId: organization.id,
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
        email: invitee.user.email,
        pwd: Date.now()
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

    expect([200, 401]).toContain(forgedList.response.status)
    if (forgedList.response.status === 200) {
      expect(forgedList.body.data).toHaveLength(0)
    }

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

    expect([401, 404]).toContain(forgedAccept.response.status)

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

  it('accepts invitations idempotently and grants organization access once', async () => {
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

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Idempotent Invitation Organization'
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
          organizationId: organization.id,
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

    const readMembershipCount = async (): Promise<number> => {
      const membershipResult = await dbAuthContext.testContext.withSchemaClient(async (client) =>
        client.query<{ membership_count: string | number }>(
          `
            SELECT COUNT(*)::int AS membership_count
            FROM org_members
            WHERE organization_id = $1
              AND user_id = $2
          `,
          [organization.id, invitee.user.id]
        )
      )

      const rawCount = membershipResult.rows[0]?.membership_count
      if (typeof rawCount === 'number') {
        return rawCount
      }

      const parsed = Number.parseInt(rawCount ?? '0', 10)
      if (Number.isNaN(parsed)) {
        throw new Error('Invalid membership count value returned from org_members query')
      }

      return parsed
    }

    const membershipCountAfterFirstAccept = await readMembershipCount()
    expect(membershipCountAfterFirstAccept).toBe(1)

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

    const membershipCountAfterSecondAccept = await readMembershipCount()
    expect(membershipCountAfterSecondAccept).toBe(1)

    const inviteeOrganizations = await requestJson<{ data: Array<{ id: string }> }>(
      '/v1/organizations',
      'list-organizations-after-accept',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(inviteeOrganizations.response.status).toBe(200)
    expect(inviteeOrganizations.body.data.some((item) => item.id === organization.id)).toBe(true)
  })

  it('rejects acceptance for expired invitation tokens', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'owner-expired-invite@example.com',
      password: 'owner-pass-12345',
      name: 'Owner Expired Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee-expired-invite@example.com',
      password: 'invitee-pass-12345',
      name: 'Invitee Expired Invite'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Expired Invitation Organization'
    })

    const createdInvitation = await requestJson<{ token: string }>(
      '/v1/invitations',
      'create-expired-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE invitations
          SET expires_at = now() - interval '1 minute'
          WHERE token = $1
        `,
        [createdInvitation.body.token]
      )
    })

    const acceptExpiredInvitation = await requestJson<{ message: string }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-expired-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(acceptExpiredInvitation.response.status).toBe(404)

    const invitationStatus = await factoryContext.testContext.withSchemaClient(async (client) =>
      client.query<{ status: string }>(
        `
          SELECT status
          FROM invitations
          WHERE token = $1
          LIMIT 1
        `,
        [createdInvitation.body.token]
      )
    )

    expect(invitationStatus.rows[0]?.status).toBe('pending')
  })

  it('rate limits repeated failed sign-in attempts', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'auth-rate-limit@example.com',
      password: 'valid-pass-12345',
      name: 'Auth Rate Limit User'
    })

    let sawRateLimit = false

    for (let attempt = 0; attempt < authRateLimitMaxRequests; attempt += 1) {
      const invalidSignIn = await requestJson<{ message: string }>(
        '/v1/auth/sign-in',
        `auth-sign-in-rate-limit-${attempt + 1}`,
        {
          method: 'POST',
          headers: {
            'x-forwarded-for': '198.51.100.24'
          },
          body: JSON.stringify({
            email: user.user.email,
            password: 'wrong-pass-12345'
          })
        }
      )

      expect([401, 429]).toContain(invalidSignIn.response.status)
      if (invalidSignIn.response.status === 429) {
        sawRateLimit = true
        break
      }
    }

    const throttledSignIn = await requestJson<{ message?: string; error?: { code?: string; message?: string } }>(
      '/v1/auth/sign-in',
      'auth-sign-in-rate-limit-throttled',
      {
        method: 'POST',
        headers: {
          'x-forwarded-for': '198.51.100.24'
        },
        body: JSON.stringify({
          email: user.user.email,
          password: 'wrong-pass-12345'
        })
      }
    )

    expect(throttledSignIn.response.status).toBe(429)
    expect(throttledSignIn.body.error?.code).toBe('TOO_MANY_REQUESTS')
    expect(sawRateLimit || throttledSignIn.response.status === 429).toBe(true)
  })

  it('prevents deleting a user who still owns organizations', async () => {
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
      name: 'Owner Delete Guard Organization'
    })

    const deleteResponse = await requestJson<{ message: string }>(
      '/v1/auth/me',
      'delete-owner-with-organization',
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
      'delete-user-without-organization',
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
