import { signSessionToken } from '@tx-agent-kit/auth'
import { createOrganization, createUser, INTEGRATION_API_PORT } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  authRateLimitIdentifierMaxRequests,
  authRateLimitMaxRequests,
  browserCookieAuthHeaders,
  createOidcTestProvider,
  createTestFixture,
  readCookieHeader,
  type OidcTestProvider
} from './test-helpers.js'

/** Generates a unique email scoped to this test run to avoid collisions in shared schemas. */
const uid = randomUUID().slice(0, 8)
const uniqueEmail = (label: string): string => `${label}-${uid}@example.com`
const isOidcTestRun = process.env.RUN_OIDC_TESTS === '1'
const oidcApiPort = Number.parseInt(
  process.env.API_INTEGRATION_TEST_PORT_AUTH_OIDC ?? String(INTEGRATION_API_PORT + 14),
  10
)

const fixture = createTestFixture({
  schemaPrefix: 'api_auth',
  autoRegisterHooks: false,
  apiPort: isOidcTestRun ? oidcApiPort : undefined
})

const { dbAuthContext, request, getFactoryContext, hooks } = fixture

let oidcTestProvider: OidcTestProvider | undefined
const oidcEmail = uniqueEmail('google-auth-login')

beforeAll(async () => {
  oidcTestProvider = await createOidcTestProvider({
    callbackUrl: `${dbAuthContext.baseUrl}/v1/auth/google/callback`,
    email: oidcEmail
  })
  await oidcTestProvider.start()
  process.env.GOOGLE_OIDC_ISSUER_URL = oidcTestProvider.issuerUrl
  process.env.GOOGLE_OIDC_CLIENT_ID = oidcTestProvider.clientId
  process.env.GOOGLE_OIDC_CLIENT_SECRET = oidcTestProvider.clientSecret
  process.env.GOOGLE_OIDC_CALLBACK_URL = oidcTestProvider.callbackUrl

  await hooks.beforeAll()
})

beforeEach(async () => {
  await hooks.beforeEach()
})

afterAll(async () => {
  await hooks.afterAll()
  if (oidcTestProvider) {
    await oidcTestProvider.stop()
  }
})

describe('auth integration', () => {
  it('supports auth + organization flow end to end', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('integration-user')
    const createdUser = await createUser(factoryContext, {
      email,
      password: 'strong-pass-12345',
      name: 'Integration User'
    })

    expect(createdUser.user.email).toBe(email)
    const token = createdUser.token

    const me = await request<{ userId: string; email: string; roles: string[] }>('/v1/auth/me', 'auth-me', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    })

    expect(me.response.status).toBe(200)
    expect(me.body.userId).toBeTruthy()

    const organization = await createOrganization(factoryContext, {
      token,
      name: 'Integration Organization'
    })

    expect(organization.name).toBe('Integration Organization')

    const listOrganizations = await request<{ data: Array<{ id: string; name: string }> }>('/v1/organizations', 'list-organizations', {
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
    const listOrganizationsWithoutToken = await request<{ message: string }>(
      '/v1/organizations',
      'unauthorized-list-organizations',
      {
        method: 'GET'
      }
    )

    expect(listOrganizationsWithoutToken.response.status).toBe(401)
  })

  it('rejects auth profile lookups without auth token', async () => {
    const meWithoutToken = await request<{ message: string }>(
      '/v1/auth/me',
      'unauthorized-auth-me',
      {
        method: 'GET'
      }
    )

    expect(meWithoutToken.response.status).toBe(401)
  })

  it('rejects sign-in with invalid credentials', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('invalid-sign-in')
    await createUser(factoryContext, {
      email,
      password: 'valid-pass-12345',
      name: 'Invalid Sign In User'
    })

    const invalidSignIn = await request<{ message: string }>(
      '/v1/auth/sign-in',
      'auth-sign-in-invalid-password',
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: 'wrong-pass-12345'
        })
      }
    )

    expect(invalidSignIn.response.status).toBe(401)
    expect(invalidSignIn.body.message).toContain('Invalid credentials')
  })

  it('rejects a malformed sign-up body with 400, not a reported 500', async () => {
    // A missing required field is a client error: it must map to 400 BadRequest
    // (and log at warn, not capture to Sentry), never fall through to a 500
    // InternalError. Regression for the schemaBodyJson ParseError mapping.
    const malformed = await request<{ message: string }>(
      '/v1/auth/sign-up',
      'auth-sign-up-malformed-body',
      {
        method: 'POST',
        body: JSON.stringify({ password: 'valid-pass-12345', name: 'No Email' })
      }
    )

    expect(malformed.response.status).toBe(400)
    expect(malformed.body.message).toBe('Invalid request body.')
  })

  it('signs in with valid credentials and returns a usable token', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('valid-sign-in')
    const createdUser = await createUser(factoryContext, {
      email,
      password: 'valid-pass-12345',
      name: 'Valid Sign In User'
    })

    const signIn = await request<{ token: string; refreshToken: string; user: { id: string; email: string } }>(
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
    expect(signIn.body.refreshToken).toBeTruthy()
    expect(signIn.body.user.email).toBe(createdUser.user.email)

    const me = await request<{ userId: string; email: string }>(
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

  it('uses HttpOnly refresh cookies for browser-origin auth flows', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('browser-cookie-sign-in')
    const createdUser = await createUser(factoryContext, {
      email,
      password: 'browser-cookie-pass-12345',
      name: 'Browser Cookie User'
    })

    const signIn = await request<{ token: string; refreshToken?: string; user: { email: string } }>(
      '/v1/auth/sign-in',
      'auth-sign-in-browser-cookie',
      {
        method: 'POST',
        headers: browserCookieAuthHeaders,
        body: JSON.stringify({
          email: createdUser.user.email,
          password: 'browser-cookie-pass-12345'
        })
      }
    )

    expect(signIn.response.status).toBe(200)
    expect(signIn.body.token).toBeTruthy()
    expect(signIn.body.refreshToken).toBeUndefined()

    const initialCookieHeader = readCookieHeader(signIn.response)
    expect(initialCookieHeader).toContain('tx-agent-kit.refresh-token=')

    const refreshed = await request<{ token: string; refreshToken?: string; user: { email: string } }>(
      '/v1/auth/refresh',
      'auth-refresh-browser-cookie',
      {
        method: 'POST',
        headers: {
          cookie: initialCookieHeader,
          ...browserCookieAuthHeaders
        },
        body: JSON.stringify({})
      }
    )

    expect(refreshed.response.status).toBe(200)
    expect(refreshed.body.token).toBeTruthy()
    expect(refreshed.body.refreshToken).toBeUndefined()
    expect(readCookieHeader(refreshed.response)).not.toBe(initialCookieHeader)
  })

  it('does not infer browser-cookie auth mode from Origin alone', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('origin-alone-sign-in')
    const createdUser = await createUser(factoryContext, {
      email,
      password: 'origin-alone-pass-12345',
      name: 'Origin Alone User'
    })

    const signIn = await request<{ token: string; refreshToken?: string; user: { email: string } }>(
      '/v1/auth/sign-in',
      'auth-sign-in-origin-alone',
      {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000'
        },
        body: JSON.stringify({
          email: createdUser.user.email,
          password: 'origin-alone-pass-12345'
        })
      }
    )

    expect(signIn.response.status).toBe(200)
    expect(signIn.body.token).toBeTruthy()
    expect(signIn.body.refreshToken).toBeTruthy()
  })

  it('rotates refresh tokens and revokes session on sign-out', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('refresh-flow')
    const createdUser = await createUser(factoryContext, {
      email,
      password: 'refresh-pass-12345',
      name: 'Refresh Flow User'
    })

    const signIn = await request<{ token: string; refreshToken: string }>(
      '/v1/auth/sign-in',
      'auth-refresh-sign-in',
      {
        method: 'POST',
        body: JSON.stringify({
          email: createdUser.user.email,
          password: 'refresh-pass-12345'
        })
      }
    )

    expect(signIn.response.status).toBe(200)

    const refreshed = await request<{ token: string; refreshToken: string; user: { id: string } }>(
      '/v1/auth/refresh',
      'auth-refresh-success',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: signIn.body.refreshToken
        })
      }
    )

    expect(refreshed.response.status).toBe(200)
    expect(refreshed.body.token).toBeTruthy()
    expect(refreshed.body.refreshToken).toBeTruthy()
    expect(refreshed.body.refreshToken).not.toBe(signIn.body.refreshToken)

    const signOut = await request<{ revoked: boolean }>(
      '/v1/auth/sign-out',
      'auth-sign-out-current-session',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${refreshed.body.token}`
        }
      }
    )

    expect(signOut.response.status).toBe(200)
    expect(signOut.body.revoked).toBe(true)

    const meAfterSignOut = await request<{ message: string }>(
      '/v1/auth/me',
      'auth-sign-out-me-revoked',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${refreshed.body.token}`
        }
      }
    )

    expect(meAfterSignOut.response.status).toBe(401)

    const refreshAfterSignOut = await request<{ message: string }>(
      '/v1/auth/refresh',
      'auth-sign-out-refresh-revoked',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: refreshed.body.refreshToken
        })
      }
    )

    expect(refreshAfterSignOut.response.status).toBe(401)
  })

  it('revokes a session when refresh token replay is detected', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('refresh-replay')
    const createdUser = await createUser(factoryContext, {
      email,
      password: 'refresh-replay-pass-12345',
      name: 'Refresh Replay User'
    })

    const signIn = await request<{ token: string; refreshToken: string }>(
      '/v1/auth/sign-in',
      'auth-refresh-replay-sign-in',
      {
        method: 'POST',
        body: JSON.stringify({
          email: createdUser.user.email,
          password: 'refresh-replay-pass-12345'
        })
      }
    )

    expect(signIn.response.status).toBe(200)

    const firstRefresh = await request<{ token: string; refreshToken: string }>(
      '/v1/auth/refresh',
      'auth-refresh-replay-first',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: signIn.body.refreshToken
        })
      }
    )
    expect(firstRefresh.response.status).toBe(200)

    const replayedRefresh = await request<{ message: string }>(
      '/v1/auth/refresh',
      'auth-refresh-replay-old-token',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: signIn.body.refreshToken
        })
      }
    )
    expect(replayedRefresh.response.status).toBe(401)

    const refreshAfterReplay = await request<{ message: string }>(
      '/v1/auth/refresh',
      'auth-refresh-replay-new-token-invalidated',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: firstRefresh.body.refreshToken
        })
      }
    )
    expect(refreshAfterReplay.response.status).toBe(401)

    const meAfterReplay = await request<{ message: string }>(
      '/v1/auth/me',
      'auth-refresh-replay-me-invalidated',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${firstRefresh.body.token}`
        }
      }
    )
    expect(meAfterReplay.response.status).toBe(401)
  })

  it('revokes all active sessions for a user', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('sign-out-all')
    const createdUser = await createUser(factoryContext, {
      email,
      password: 'sign-out-all-pass-12345',
      name: 'Sign Out All User'
    })

    const firstSession = await request<{ token: string; refreshToken: string }>(
      '/v1/auth/sign-in',
      'auth-sign-out-all-first-session',
      {
        method: 'POST',
        body: JSON.stringify({
          email: createdUser.user.email,
          password: 'sign-out-all-pass-12345'
        })
      }
    )

    const secondSession = await request<{ token: string; refreshToken: string }>(
      '/v1/auth/sign-in',
      'auth-sign-out-all-second-session',
      {
        method: 'POST',
        body: JSON.stringify({
          email: createdUser.user.email,
          password: 'sign-out-all-pass-12345'
        })
      }
    )

    expect(firstSession.response.status).toBe(200)
    expect(secondSession.response.status).toBe(200)

    const signOutAll = await request<{ revokedSessions: number }>(
      '/v1/auth/sign-out-all',
      'auth-sign-out-all',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${firstSession.body.token}`
        }
      }
    )

    expect(signOutAll.response.status).toBe(200)
    expect(signOutAll.body.revokedSessions).toBeGreaterThanOrEqual(2)

    const firstMe = await request<{ message: string }>(
      '/v1/auth/me',
      'auth-sign-out-all-first-me',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${firstSession.body.token}`
        }
      }
    )

    const secondMe = await request<{ message: string }>(
      '/v1/auth/me',
      'auth-sign-out-all-second-me',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${secondSession.body.token}`
        }
      }
    )

    expect(firstMe.response.status).toBe(401)
    expect(secondMe.response.status).toBe(401)

    const firstRefreshAfterSignOutAll = await request<{ message: string }>(
      '/v1/auth/refresh',
      'auth-sign-out-all-first-refresh-revoked',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: firstSession.body.refreshToken
        })
      }
    )

    const secondRefreshAfterSignOutAll = await request<{ message: string }>(
      '/v1/auth/refresh',
      'auth-sign-out-all-second-refresh-revoked',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: secondSession.body.refreshToken
        })
      }
    )

    expect(firstRefreshAfterSignOutAll.response.status).toBe(401)
    expect(secondRefreshAfterSignOutAll.response.status).toBe(401)
  })

  // OIDC tests require env vars in the API server process. With the shared server
  // architecture these env vars cannot be injected, so skip unless explicitly opted in.
  it.skipIf(process.env.RUN_OIDC_TESTS !== '1')('supports Google OIDC login and auto-links by verified email', async () => {
    const factoryContext = getFactoryContext()

    const existingUser = await createUser(factoryContext, {
      email: oidcEmail,
      password: 'google-link-pass-12345',
      name: 'Google Link User'
    })

    const googleStart = await request<{ authorizationUrl: string; state: string; expiresAt: string }>(
      '/v1/auth/google/start',
      'google-auth-start',
      {
        method: 'GET',
        headers: {
          'x-forwarded-for': '203.0.113.50'
        }
      }
    )

    expect(googleStart.response.status).toBe(200)
    expect(googleStart.body.authorizationUrl).toContain('/authorize')
    expect(googleStart.body.state.length).toBeGreaterThan(0)
    expect(googleStart.body.expiresAt.length).toBeGreaterThan(0)

    const persistedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        provider: string
        nonce: string
        codeVerifier: string
        consumedAt: Date | null
      }>(
        `
          SELECT provider,
                 nonce,
                 code_verifier AS "codeVerifier",
                 consumed_at AS "consumedAt"
          FROM auth_login_oidc_states
          WHERE state = $1
          LIMIT 1
        `,
        [googleStart.body.state]
      )

      return result.rows[0] ?? null
    })

    expect(persistedState).not.toBeNull()
    expect(persistedState?.provider).toBe('google')
    expect(persistedState?.nonce).toBe('')
    expect((persistedState?.codeVerifier ?? '').length).toBeGreaterThan(0)
    expect(persistedState?.consumedAt).toBeNull()

    const providerAuthorization = await fetch(googleStart.body.authorizationUrl, {
      redirect: 'manual'
    })
    expect(providerAuthorization.status).toBe(302)
    const callbackUrl = providerAuthorization.headers.get('location')
    if (!callbackUrl) {
      throw new Error('Google test provider did not return a callback redirect URL')
    }

    const callbackResponse = await fetch(callbackUrl, {
      headers: dbAuthContext.testContext.headersForCase('google-auth-callback')
    })
    const callbackBody = await callbackResponse.json() as {
      token: string
      refreshToken?: string
      user: { id: string; email: string }
    }

    expect(callbackResponse.status).toBe(200)
    expect(callbackBody.token).toBeTruthy()
    expect(callbackBody.refreshToken).toBeTruthy()
    expect(callbackBody.user.email).toBe(existingUser.user.email)
    expect(callbackBody.user.id).toBe(existingUser.user.id)
    // S5 fix: non-browser OIDC callbacks no longer set refresh cookies
    expect(callbackResponse.headers.get('set-cookie')).toBeNull()

    const me = await request<{ userId: string; email: string }>(
      '/v1/auth/me',
      'google-auth-me',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${callbackBody.token}`
        }
      }
    )

    expect(me.response.status).toBe(200)
    expect(me.body.userId).toBe(existingUser.user.id)
    expect(me.body.email).toBe(existingUser.user.email)

    const consumedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ consumedAt: Date | null }>(
        `
          SELECT consumed_at AS "consumedAt"
          FROM auth_login_oidc_states
          WHERE state = $1
          LIMIT 1
        `,
        [googleStart.body.state]
      )

      return result.rows[0]?.consumedAt ?? null
    })

    expect(consumedState).not.toBeNull()

    const linkedIdentityCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM auth_login_identities
          WHERE user_id = $1
            AND provider = 'google'
        `,
        [existingUser.user.id]
      )

      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })

    expect(linkedIdentityCount).toBe(1)
  })

  it.skipIf(process.env.RUN_OIDC_TESTS !== '1')('uses cookie-managed session mode for Google OIDC when explicitly requested at start', async () => {
    const googleStart = await request<{ authorizationUrl: string; state: string; expiresAt: string }>(
      '/v1/auth/google/start',
      'google-auth-browser-cookie-start',
      {
        method: 'GET',
        headers: browserCookieAuthHeaders
      }
    )

    expect(googleStart.response.status).toBe(200)
    expect(googleStart.body.state.startsWith('bc_')).toBe(true)

    const providerAuthorization = await fetch(googleStart.body.authorizationUrl, {
      redirect: 'manual'
    })
    expect(providerAuthorization.status).toBe(302)
    const callbackUrl = providerAuthorization.headers.get('location')
    if (!callbackUrl) {
      throw new Error('Google test provider did not return a callback redirect URL')
    }

    const callbackResponse = await fetch(callbackUrl, {
      headers: dbAuthContext.testContext.headersForCase('google-auth-browser-cookie-callback')
    })
    const callbackBody = await callbackResponse.json() as {
      token: string
      refreshToken?: string
      user: { email: string }
    }

    expect(callbackResponse.status).toBe(200)
    expect(callbackBody.token).toBeTruthy()
    expect(callbackBody.refreshToken).toBeUndefined()

    const callbackCookieHeader = readCookieHeader(callbackResponse)
    expect(callbackCookieHeader).toContain('tx-agent-kit.refresh-token=')

    const refreshed = await request<{ token: string; refreshToken?: string; user: { email: string } }>(
      '/v1/auth/refresh',
      'google-auth-browser-cookie-refresh',
      {
        method: 'POST',
        headers: {
          cookie: callbackCookieHeader,
          ...browserCookieAuthHeaders
        },
        body: JSON.stringify({})
      }
    )

    expect(refreshed.response.status).toBe(200)
    expect(refreshed.body.token).toBeTruthy()
    expect(refreshed.body.refreshToken).toBeUndefined()
  })

  it('rejects Google OIDC callback when state is invalid', async () => {
    const callback = await request<{ message: string }>(
      '/v1/auth/google/callback?code=unused-code&state=invalid-state',
      'google-auth-invalid-state',
      {
        method: 'GET'
      }
    )

    expect(callback.response.status).toBe(401)
    expect(callback.body.message).toContain('Invalid Google authorization response')
  })

  it('expires the browser refresh cookie when a cookie-managed Google callback fails', async () => {
    const callback = await request<{ message: string }>(
      '/v1/auth/google/callback?code=unused-code&state=bc_invalid-state',
      'google-auth-browser-cookie-invalid-state',
      {
        method: 'GET',
        headers: {
          cookie: 'tx-agent-kit.refresh-token=stale-refresh-token',
          ...browserCookieAuthHeaders
        }
      }
    )

    expect(callback.response.status).toBe(401)
    expect(callback.body.message).toContain('Invalid Google authorization response')
    expect(readCookieHeader(callback.response)).toBe('tx-agent-kit.refresh-token=')
  })

  it.skipIf(process.env.RUN_OIDC_TESTS !== '1')('rejects Google OIDC callback when issuer response parameter is not forwarded', async () => {
    const issuerUrl = oidcTestProvider?.issuerUrl
    if (!issuerUrl) {
      throw new Error('OIDC test provider was not initialized')
    }

    const googleStart = await request<{ authorizationUrl: string; state: string }>(
      '/v1/auth/google/start',
      'google-auth-missing-issuer-start',
      {
        method: 'GET',
        headers: {
          'x-forwarded-for': '203.0.113.77'
        }
      }
    )

    expect(googleStart.response.status).toBe(200)

    const providerAuthorization = await fetch(googleStart.body.authorizationUrl, {
      redirect: 'manual'
    })
    expect(providerAuthorization.status).toBe(302)

    const callbackUrl = providerAuthorization.headers.get('location')
    if (!callbackUrl) {
      throw new Error('Google test provider did not return a callback redirect URL')
    }

    const callbackUrlWithoutIssuer = new URL(callbackUrl)
    expect(callbackUrlWithoutIssuer.searchParams.get('iss')).toBe(issuerUrl)
    callbackUrlWithoutIssuer.searchParams.delete('iss')

    const callback = await fetch(callbackUrlWithoutIssuer, {
      headers: dbAuthContext.testContext.headersForCase('google-auth-missing-issuer-callback')
    })
    const callbackBody = await callback.json() as { message: string }

    expect(callback.status).toBe(401)
    expect(callbackBody.message).toContain('Invalid Google authorization response')
  })

  it.skipIf(process.env.RUN_OIDC_TESTS !== '1')('rejects Google OIDC callback when state is expired', async () => {
    const factoryContext = getFactoryContext()

    const googleStart = await request<{ authorizationUrl: string; state: string }>(
      '/v1/auth/google/start',
      'google-auth-expired-state-start',
      {
        method: 'GET',
        headers: {
          'x-forwarded-for': '203.0.113.76'
        }
      }
    )

    expect(googleStart.response.status).toBe(200)

    const providerAuthorization = await fetch(googleStart.body.authorizationUrl, {
      redirect: 'manual'
    })
    expect(providerAuthorization.status).toBe(302)

    const callbackUrl = providerAuthorization.headers.get('location')
    if (!callbackUrl) {
      throw new Error('Google test provider did not return a callback redirect URL')
    }

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE auth_login_oidc_states
          SET expires_at = now() - interval '1 second'
          WHERE state = $1
        `,
        [googleStart.body.state]
      )
    })

    const callback = await fetch(callbackUrl, {
      headers: dbAuthContext.testContext.headersForCase('google-auth-expired-state-callback')
    })
    const callbackBody = await callback.json() as { message: string }

    expect(callback.status).toBe(401)
    expect(callbackBody.message).toContain('Invalid Google authorization response')

    const consumedAt = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ consumedAt: Date | null }>(
        `
          SELECT consumed_at AS "consumedAt"
          FROM auth_login_oidc_states
          WHERE state = $1
          LIMIT 1
        `,
        [googleStart.body.state]
      )

      return result.rows[0]?.consumedAt ?? null
    })

    expect(consumedAt).toBeNull()
  })

  it.skipIf(process.env.RUN_OIDC_TESTS !== '1')('rejects replayed Google OIDC callback state after first successful use', async () => {
    const googleStart = await request<{ authorizationUrl: string }>(
      '/v1/auth/google/start',
      'google-auth-replay-start',
      {
        method: 'GET',
        headers: {
          'x-forwarded-for': '203.0.113.75'
        }
      }
    )

    expect(googleStart.response.status).toBe(200)

    const providerAuthorization = await fetch(googleStart.body.authorizationUrl, {
      redirect: 'manual'
    })
    expect(providerAuthorization.status).toBe(302)

    const callbackUrl = providerAuthorization.headers.get('location')
    if (!callbackUrl) {
      throw new Error('Google test provider did not return a callback redirect URL')
    }

    const firstCallback = await fetch(callbackUrl, {
      headers: dbAuthContext.testContext.headersForCase('google-auth-replay-first')
    })
    expect(firstCallback.status).toBe(200)

    const secondCallback = await fetch(callbackUrl, {
      headers: dbAuthContext.testContext.headersForCase('google-auth-replay-second')
    })
    const secondBody = await secondCallback.json() as { message: string }

    expect(secondCallback.status).toBe(401)
    expect(secondBody.message).toContain('Invalid Google authorization response')
  })

  it('writes auth audit events for critical flows', async () => {
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('audit-events-user')
    const user = await createUser(factoryContext, {
      email,
      password: 'audit-events-old-pass-12345',
      name: 'Audit Events User'
    })

    const failedSignIn = await request<{ message: string }>(
      '/v1/auth/sign-in',
      'audit-events-sign-in-failure',
      {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.61'
        },
        body: JSON.stringify({
          email: user.user.email,
          password: 'audit-events-wrong-pass-12345'
        })
      }
    )
    expect(failedSignIn.response.status).toBe(401)

    const forgotPassword = await request<{ accepted: boolean }>(
      '/v1/auth/forgot-password',
      'audit-events-forgot-password',
      {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.62'
        },
        body: JSON.stringify({
          email: user.user.email
        })
      }
    )
    expect(forgotPassword.response.status).toBe(202)

    const resetRawToken = `audit-events-reset-token-${uid}`
    const resetTokenHash = createHash('sha256').update(resetRawToken, 'utf8').digest('hex')
    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES ($1, $2, now() + interval '30 minutes')
        `,
        [user.user.id, resetTokenHash]
      )
    })

    const resetPassword = await request<{ reset: boolean }>(
      '/v1/auth/reset-password',
      'audit-events-reset-password',
      {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.63'
        },
        body: JSON.stringify({
          token: resetRawToken,
          password: 'audit-events-new-pass-12345'
        })
      }
    )
    expect(resetPassword.response.status).toBe(200)
    expect(resetPassword.body.reset).toBe(true)

    const successfulSignIn = await request<{ token: string; refreshToken: string }>(
      '/v1/auth/sign-in',
      'audit-events-sign-in-success',
      {
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.64'
        },
        body: JSON.stringify({
          email: user.user.email,
          password: 'audit-events-new-pass-12345'
        })
      }
    )
    expect(successfulSignIn.response.status).toBe(200)

    const auditCounts = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        eventType: string
        total: string
      }>(
        `
          SELECT event_type AS "eventType", COUNT(*)::text AS total
          FROM auth_login_audit_events
          WHERE identifier = $1
          GROUP BY event_type
        `,
        [email]
      )

      return result.rows.reduce<Record<string, number>>((accumulator, row) => ({
        ...accumulator,
        [row.eventType]: Number.parseInt(row.total, 10)
      }), {})
    })

    expect((auditCounts['login_failure'] ?? 0)).toBeGreaterThanOrEqual(1)
    expect((auditCounts['login_success'] ?? 0)).toBeGreaterThanOrEqual(1)
    expect((auditCounts['password_reset_requested'] ?? 0)).toBeGreaterThanOrEqual(1)
    expect((auditCounts['password_changed'] ?? 0)).toBeGreaterThanOrEqual(1)
  })

  it('signs up users and rejects duplicate emails', async () => {
    const signupEmail = uniqueEmail('signup-flow')
    const signUp = await request<{ token: string; refreshToken: string; user: { id: string; email: string } }>(
      '/v1/auth/sign-up',
      'auth-sign-up-success',
      {
        method: 'POST',
        body: JSON.stringify({
          email: signupEmail,
          password: 'signup-pass-12345',
          name: 'Signup Flow'
        })
      }
    )

    expect(signUp.response.status).toBe(201)
    expect(signUp.body.token.length).toBeGreaterThan(0)
    expect(signUp.body.refreshToken.length).toBeGreaterThan(0)
    expect(signUp.body.user.email).toBe(signupEmail)

    const me = await request<{ userId: string; email: string }>(
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
    expect(me.body.email).toBe(signupEmail)

    const duplicateSignUp = await request<{ message: string }>(
      '/v1/auth/sign-up',
      'auth-sign-up-duplicate',
      {
        method: 'POST',
        body: JSON.stringify({
          email: signupEmail,
          password: 'signup-pass-12345',
          name: 'Signup Flow Duplicate'
        })
      }
    )

    expect(duplicateSignUp.response.status).toBe(409)
    expect(duplicateSignUp.body.message.length).toBeGreaterThan(0)
  })

  it('returns deterministic conflict for concurrent duplicate sign-up attempts', async () => {
    const signupEmail = uniqueEmail('concurrent-signup')

    const [attemptOne, attemptTwo] = await Promise.all([
      request<{ token?: string; user?: { email: string }; message?: string }>(
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
      request<{ token?: string; user?: { email: string }; message?: string }>(
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

    const signIn = await request<{ token: string }>(
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
    const factoryContext = getFactoryContext()

    const email = uniqueEmail('forgot-password-existing')
    const existingUser = await createUser(factoryContext, {
      email,
      password: 'forgot-existing-pass-12345',
      name: 'Forgot Existing User'
    })

    const existingForgot = await request<{ accepted: boolean }>(
      '/v1/auth/forgot-password',
      'auth-forgot-password-existing',
      {
        method: 'POST',
        body: JSON.stringify({
          email: existingUser.user.email
        })
      }
    )

    const existingForgotAgain = await request<{ accepted: boolean }>(
      '/v1/auth/forgot-password',
      'auth-forgot-password-existing-again',
      {
        method: 'POST',
        body: JSON.stringify({
          email: existingUser.user.email
        })
      }
    )

    const missingForgot = await request<{ accepted: boolean }>(
      '/v1/auth/forgot-password',
      'auth-forgot-password-missing',
      {
        method: 'POST',
        body: JSON.stringify({
          email: uniqueEmail('missing-user-forgot-password')
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
        total: string
        activeCount: string
        usedCount: string
      }>(
        `
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE used_at IS NULL AND expires_at > now())::text AS "activeCount",
            COUNT(*) FILTER (WHERE used_at IS NOT NULL)::text AS "usedCount"
          FROM password_reset_tokens
          WHERE user_id = $1
        `,
        [existingUser.user.id]
      )

      const row = result.rows[0]
      return {
        total: Number.parseInt(row?.total ?? '0', 10),
        activeCount: Number.parseInt(row?.activeCount ?? '0', 10),
        usedCount: Number.parseInt(row?.usedCount ?? '0', 10)
      }
    })

    expect(resetTokenCounts.total).toBe(2)
    expect(resetTokenCounts.activeCount).toBe(1)
    expect(resetTokenCounts.usedCount).toBe(1)
  })

  it('resets passwords with one-time tokens', async () => {
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      email: uniqueEmail('reset-password-user'),
      password: 'reset-password-old-12345',
      name: 'Reset Password User'
    })

    const rawToken = `integration-reset-token-${uid}`
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

    const reset = await request<{ reset: boolean }>(
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

    const meWithPreResetToken = await request<{ message: string }>(
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

    const oldPasswordSignIn = await request<{ message: string }>(
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

    const newPasswordSignIn = await request<{ token: string }>(
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

    const reusedToken = await request<{ message: string }>(
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
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      email: uniqueEmail('expired-reset-password-user'),
      password: 'expired-reset-password-old-12345',
      name: 'Expired Reset Password User'
    })

    const rawToken = `integration-expired-reset-token-${uid}`
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

    const reset = await request<{ message: string }>(
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

    const oldPasswordSignIn = await request<{ token: string }>(
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

  // Rate limit tests are incompatible with the shared server (rate limits are
  // effectively disabled at 100000 max requests). Skip unless opted in.
  it.skipIf(process.env.RUN_RATE_LIMIT_TESTS !== '1')('rate limits repeated failed sign-in attempts', async () => {
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      email: uniqueEmail('auth-rate-limit'),
      password: 'valid-pass-12345',
      name: 'Auth Rate Limit User'
    })

    let sawRateLimit = false

    for (let attempt = 0; attempt < authRateLimitMaxRequests; attempt += 1) {
      const invalidSignIn = await request<{ message: string }>(
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

    const throttledSignIn = await request<{ message?: string; error?: { code?: string; message?: string } }>(
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

  it.skipIf(process.env.RUN_RATE_LIMIT_TESTS !== '1')('rate limits failed sign-in attempts by identifier across different IPs', async () => {
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      email: uniqueEmail('auth-rate-limit-identifier'),
      password: 'valid-pass-12345',
      name: 'Auth Rate Limit Identifier User'
    })

    let sawRateLimit = false

    for (let attempt = 0; attempt < authRateLimitIdentifierMaxRequests + 2; attempt += 1) {
      const invalidSignIn = await request<{ message?: string; error?: { code?: string; message?: string } }>(
        '/v1/auth/sign-in',
        `auth-sign-in-rate-limit-identifier-${attempt + 1}`,
        {
          method: 'POST',
          headers: {
            'x-forwarded-for': `198.51.100.${attempt + 30}`
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
        expect(
          invalidSignIn.body.error?.code === 'TOO_MANY_REQUESTS' ||
          (invalidSignIn.body.message ?? '').includes('Too many authentication attempts')
        ).toBe(true)
        break
      }
    }

    expect(sawRateLimit).toBe(true)
  })

  it.skipIf(process.env.RUN_RATE_LIMIT_TESTS !== '1')('rate limits forgot-password attempts by identifier across different IPs', async () => {
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      email: uniqueEmail('forgot-password-rate-limit-identifier'),
      password: 'valid-pass-12345',
      name: 'Forgot Password Rate Limit User'
    })

    let sawRateLimit = false

    for (let attempt = 0; attempt < authRateLimitIdentifierMaxRequests + 2; attempt += 1) {
      const forgotPassword = await request<{ accepted?: boolean; message?: string; error?: { code?: string; message?: string } }>(
        '/v1/auth/forgot-password',
        `auth-forgot-password-rate-limit-identifier-${attempt + 1}`,
        {
          method: 'POST',
          headers: {
            'x-forwarded-for': `198.51.100.${attempt + 90}`
          },
          body: JSON.stringify({
            email: user.user.email
          })
        }
      )

      expect([200, 202, 429]).toContain(forgotPassword.response.status)
      if (forgotPassword.response.status === 429) {
        sawRateLimit = true
        expect(
          forgotPassword.body.error?.code === 'TOO_MANY_REQUESTS' ||
          (
            forgotPassword.body.error?.message ??
            forgotPassword.body.message ??
            ''
          ).includes('Too many authentication attempts')
        ).toBe(true)
        break
      }
    }

    expect(sawRateLimit).toBe(true)
  })

  it('prevents deleting a user who still owns organizations', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: uniqueEmail('delete-owner'),
      password: 'strong-pass-12345',
      name: 'Delete Owner'
    })

    await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Owner Delete Guard Organization'
    })

    const deleteResponse = await request<{ message: string }>(
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
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      email: uniqueEmail('delete-token'),
      password: 'strong-pass-12345',
      name: 'Delete Token User'
    })

    const deleteResponse = await request<{ deleted: boolean }>(
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

    const meAfterDelete = await request<{ message: string }>(
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

  it('revokes all refresh tokens for a deleted user', async () => {
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      email: uniqueEmail('delete-refresh-token'),
      password: 'strong-pass-12345',
      name: 'Delete Refresh Token User'
    })

    // createUser returns a refreshToken from sign-up — use it directly to avoid
    // consuming rate-limit budget on /v1/auth/sign-in.
    const refreshToken = user.refreshToken

    const deleteResponse = await request<{ deleted: boolean }>(
      '/v1/auth/me',
      'delete-user-refresh-delete',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${user.token}`
        }
      }
    )
    expect(deleteResponse.response.status).toBe(200)
    expect(deleteResponse.body.deleted).toBe(true)

    const refreshAfterDelete = await request<{ message: string }>(
      '/v1/auth/refresh',
      'delete-user-refresh-after-delete',
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
      }
    )
    expect(refreshAfterDelete.response.status).toBe(401)
  })

  it('uses canonical user identity for invitation listing and acceptance', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: uniqueEmail('owner-identity'),
      password: 'strong-pass-12345',
      name: 'Owner Identity'
    })

    const invitee = await createUser(factoryContext, {
      email: uniqueEmail('invitee-identity'),
      password: 'strong-pass-12345',
      name: 'Invitee Identity'
    })

    const attacker = await createUser(factoryContext, {
      email: uniqueEmail('attacker-identity'),
      password: 'strong-pass-12345',
      name: 'Attacker Identity'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Identity Guard Organization'
    })

    const createdInvitation = await request<{ id: string; token: string }>(
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
        pwd: Date.now(),
        sid: '11111111-1111-1111-1111-111111111111'
      })
    )

    const forgedList = await request<{ data: Array<{ id: string }> }>(
      '/v1/invitations',
      'list-invitations-forged-token',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${forgedToken}`
        }
      }
    )

    expect(forgedList.response.status).toBe(401)

    const forgedAccept = await request<{ message?: string }>(
      `/v1/invitations/${invitationToken}/accept`,
      'accept-invitation-forged-token',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${forgedToken}`
        }
      }
    )

    expect(forgedAccept.response.status).toBe(401)

    const inviteeAccept = await request<{ accepted: boolean }>(
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
})
