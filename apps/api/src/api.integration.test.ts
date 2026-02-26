import { signSessionToken } from '@tx-agent-kit/auth'
import { createDbAuthContext, createTeam, createUser, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportJWK, SignJWT, type JWK } from 'jose'
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
const authRateLimitIdentifierMaxRequests = parsePositiveInt(
  process.env.API_AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS,
  authRateLimitMaxRequests
)
const integrationAuthSecret = 'integration-auth-secret-12345'
process.env.AUTH_SECRET = integrationAuthSecret
process.env.AUTH_RATE_LIMIT_WINDOW_MS = String(authRateLimitWindowMs)
process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = String(authRateLimitMaxRequests)
process.env.AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS = String(authRateLimitIdentifierMaxRequests)

interface OidcAuthorizationCodeRecord {
  clientId: string
  redirectUri: string
  codeChallenge: string
  nonce: string
}

interface OidcTestProvider {
  issuerUrl: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  email: string
  start: () => Promise<void>
  stop: () => Promise<void>
}

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request as AsyncIterable<string | Buffer>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
}

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(payload))
}

const toCodeChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url')

const createOidcTestProvider = async (input: {
  callbackUrl: string
  email: string
}): Promise<OidcTestProvider> => {
  const clientId = 'tx-agent-kit-api-client'
  const clientSecret = 'tx-agent-kit-api-client-secret'
  const issuedSubject = 'oidc-test-subject-1'
  const issuedName = 'OIDC Test User'
  const authorizationCodes = new Map<string, OidcAuthorizationCodeRecord>()
  const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = await exportJWK(signingKeys.publicKey)
  const jwkWithMetadata: JWK = {
    ...publicJwk,
    alg: 'RS256',
    use: 'sig',
    kid: 'oidc-test-key'
  }

  let issuerUrl = ''
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (!request.url) {
          sendJson(response, 404, { error: 'missing_request_url' })
          return
        }

        const requestUrl = new URL(request.url, issuerUrl || 'http://127.0.0.1')
        const path = requestUrl.pathname

        if (path === '/.well-known/openid-configuration') {
          sendJson(response, 200, {
            issuer: issuerUrl,
            authorization_endpoint: `${issuerUrl}/authorize`,
            token_endpoint: `${issuerUrl}/token`,
            jwks_uri: `${issuerUrl}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            grant_types_supported: ['authorization_code'],
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
            claims_supported: ['sub', 'email', 'email_verified', 'name', 'nonce'],
            code_challenge_methods_supported: ['S256']
          })
          return
        }

        if (path === '/jwks') {
          sendJson(response, 200, { keys: [jwkWithMetadata] })
          return
        }

        if (path === '/authorize') {
          const state = requestUrl.searchParams.get('state')
          const nonce = requestUrl.searchParams.get('nonce')
          const redirectUri = requestUrl.searchParams.get('redirect_uri')
          const responseType = requestUrl.searchParams.get('response_type')
          const requestedClientId = requestUrl.searchParams.get('client_id')
          const codeChallenge = requestUrl.searchParams.get('code_challenge')
          const codeChallengeMethod = requestUrl.searchParams.get('code_challenge_method')

          if (
            !state ||
            !nonce ||
            !redirectUri ||
            responseType !== 'code' ||
            requestedClientId !== clientId ||
            codeChallengeMethod !== 'S256' ||
            !codeChallenge
          ) {
            sendJson(response, 400, { error: 'invalid_authorize_request' })
            return
          }

          const authorizationCode = randomBytes(24).toString('base64url')
          authorizationCodes.set(authorizationCode, {
            clientId: requestedClientId,
            redirectUri,
            codeChallenge,
            nonce
          })

          response.statusCode = 302
          response.setHeader(
            'location',
            `${redirectUri}?code=${encodeURIComponent(authorizationCode)}&state=${encodeURIComponent(state)}`
          )
          response.end()
          return
        }

        if (path === '/token') {
          const body = await readRequestBody(request)
          const params = new URLSearchParams(body)
          const authHeader = request.headers.authorization
          const code = params.get('code')
          const grantType = params.get('grant_type')
          const redirectUri = params.get('redirect_uri')
          const codeVerifier = params.get('code_verifier')

          let requestedClientId = params.get('client_id')
          let requestedClientSecret = params.get('client_secret')
          if (typeof authHeader === 'string' && authHeader.startsWith('Basic ')) {
            const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8')
            const [basicClientId, basicClientSecret] = decoded.split(':')
            requestedClientId = basicClientId ?? null
            requestedClientSecret = basicClientSecret ?? null
          }

          if (
            grantType !== 'authorization_code' ||
            !code ||
            !codeVerifier ||
            !redirectUri ||
            requestedClientId !== clientId ||
            requestedClientSecret !== clientSecret
          ) {
            sendJson(response, 400, { error: 'invalid_token_request' })
            return
          }

          const codeRecord = authorizationCodes.get(code)
          if (!codeRecord || codeRecord.redirectUri !== redirectUri || codeRecord.clientId !== requestedClientId) {
            sendJson(response, 400, { error: 'invalid_grant' })
            return
          }

          if (toCodeChallenge(codeVerifier) !== codeRecord.codeChallenge) {
            sendJson(response, 400, { error: 'invalid_grant' })
            return
          }

          authorizationCodes.delete(code)
          const idToken = await new SignJWT({
            email: input.email,
            email_verified: true,
            name: issuedName,
            nonce: codeRecord.nonce
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'oidc-test-key' })
            .setIssuer(issuerUrl)
            .setAudience(clientId)
            .setSubject(issuedSubject)
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(signingKeys.privateKey)

          sendJson(response, 200, {
            access_token: 'oidc-test-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: idToken
          })
          return
        }

        sendJson(response, 404, { error: 'not_found' })
      } catch {
        if (!response.writableEnded) {
          sendJson(response, 500, { error: 'oidc_provider_internal_error' })
        }
      }
    })()
  })

  return {
    get issuerUrl() {
      return issuerUrl
    },
    clientId,
    clientSecret,
    callbackUrl: input.callbackUrl,
    email: input.email,
    start: async () =>
      new Promise<void>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as AddressInfo | null
          if (!address) {
            reject(new Error('OIDC provider failed to bind to an address'))
            return
          }

          issuerUrl = `http://127.0.0.1:${address.port}`
          resolve()
        })
      }),
    stop: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
  }
}

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
let oidcTestProvider: OidcTestProvider | undefined

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
  oidcTestProvider = await createOidcTestProvider({
    callbackUrl: `${dbAuthContext.baseUrl}/v1/auth/google/callback`,
    email: 'google-auth-login@example.com'
  })
  await oidcTestProvider.start()
  process.env.GOOGLE_OIDC_ISSUER_URL = oidcTestProvider.issuerUrl
  process.env.GOOGLE_OIDC_CLIENT_ID = oidcTestProvider.clientId
  process.env.GOOGLE_OIDC_CLIENT_SECRET = oidcTestProvider.clientSecret
  process.env.GOOGLE_OIDC_CALLBACK_URL = oidcTestProvider.callbackUrl

  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
  factoryContext = dbAuthContext.apiFactoryContext
})

afterAll(async () => {
  await dbAuthContext.teardown()
  if (oidcTestProvider) {
    await oidcTestProvider.stop()
  }
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

    const signIn = await requestJson<{ token: string; refreshToken: string; user: { id: string; email: string } }>(
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

  it('rotates refresh tokens and revokes session on sign-out', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const createdUser = await createUser(factoryContext, {
      email: 'refresh-flow@example.com',
      password: 'refresh-pass-12345',
      name: 'Refresh Flow User'
    })

    const signIn = await requestJson<{ token: string; refreshToken: string }>(
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

    const refreshed = await requestJson<{ token: string; refreshToken: string; user: { id: string } }>(
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

    const signOut = await requestJson<{ revoked: boolean }>(
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

    const meAfterSignOut = await requestJson<{ message: string }>(
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

    const refreshAfterSignOut = await requestJson<{ message: string }>(
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
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const createdUser = await createUser(factoryContext, {
      email: 'refresh-replay@example.com',
      password: 'refresh-replay-pass-12345',
      name: 'Refresh Replay User'
    })

    const signIn = await requestJson<{ token: string; refreshToken: string }>(
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

    const firstRefresh = await requestJson<{ token: string; refreshToken: string }>(
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

    const replayedRefresh = await requestJson<{ message: string }>(
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

    const refreshAfterReplay = await requestJson<{ message: string }>(
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

    const meAfterReplay = await requestJson<{ message: string }>(
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
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const createdUser = await createUser(factoryContext, {
      email: 'sign-out-all@example.com',
      password: 'sign-out-all-pass-12345',
      name: 'Sign Out All User'
    })

    const firstSession = await requestJson<{ token: string; refreshToken: string }>(
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

    const secondSession = await requestJson<{ token: string; refreshToken: string }>(
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

    const signOutAll = await requestJson<{ revokedSessions: number }>(
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

    const firstMe = await requestJson<{ message: string }>(
      '/v1/auth/me',
      'auth-sign-out-all-first-me',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${firstSession.body.token}`
        }
      }
    )

    const secondMe = await requestJson<{ message: string }>(
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

    const firstRefreshAfterSignOutAll = await requestJson<{ message: string }>(
      '/v1/auth/refresh',
      'auth-sign-out-all-first-refresh-revoked',
      {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: firstSession.body.refreshToken
        })
      }
    )

    const secondRefreshAfterSignOutAll = await requestJson<{ message: string }>(
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

  it('supports Google OIDC login and auto-links by verified email', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const existingUser = await createUser(factoryContext, {
      email: 'google-auth-login@example.com',
      password: 'google-link-pass-12345',
      name: 'Google Link User'
    })

    const googleStart = await requestJson<{ authorizationUrl: string; state: string; expiresAt: string }>(
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
    expect((persistedState?.nonce ?? '').length).toBeGreaterThan(0)
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
      refreshToken: string
      user: { id: string; email: string }
    }

    expect(callbackResponse.status).toBe(200)
    expect(callbackBody.token).toBeTruthy()
    expect(callbackBody.refreshToken).toBeTruthy()
    expect(callbackBody.user.email).toBe(existingUser.user.email)
    expect(callbackBody.user.id).toBe(existingUser.user.id)

    const me = await requestJson<{ userId: string; email: string }>(
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

  it('rejects Google OIDC callback when state is invalid', async () => {
    const callback = await requestJson<{ message: string }>(
      '/v1/auth/google/callback?code=unused-code&state=invalid-state',
      'google-auth-invalid-state',
      {
        method: 'GET'
      }
    )

    expect(callback.response.status).toBe(401)
    expect(callback.body.message).toContain('Invalid Google authorization response')
  })

  it('rejects Google OIDC callback when state is expired', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const googleStart = await requestJson<{ authorizationUrl: string; state: string }>(
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

  it('rejects replayed Google OIDC callback state after first successful use', async () => {
    const googleStart = await requestJson<{ authorizationUrl: string }>(
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
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'audit-events-user@example.com',
      password: 'audit-events-old-pass-12345',
      name: 'Audit Events User'
    })

    const failedSignIn = await requestJson<{ message: string }>(
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

    const forgotPassword = await requestJson<{ accepted: boolean }>(
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

    const resetRawToken = 'audit-events-reset-token'
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

    const resetPassword = await requestJson<{ reset: boolean }>(
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

    const successfulSignIn = await requestJson<{ token: string; refreshToken: string }>(
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
          GROUP BY event_type
        `
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
    const signUp = await requestJson<{ token: string; refreshToken: string; user: { id: string; email: string } }>(
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
    expect(signUp.body.refreshToken.length).toBeGreaterThan(0)
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
        pwd: Date.now(),
        sid: '11111111-1111-1111-1111-111111111111'
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

  it('rate limits failed sign-in attempts by identifier across different IPs', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'auth-rate-limit-identifier@example.com',
      password: 'valid-pass-12345',
      name: 'Auth Rate Limit Identifier User'
    })

    let sawRateLimit = false

    for (let attempt = 0; attempt < authRateLimitIdentifierMaxRequests + 2; attempt += 1) {
      const invalidSignIn = await requestJson<{ message?: string; error?: { code?: string; message?: string } }>(
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

  it('rate limits forgot-password attempts by identifier across different IPs', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'forgot-password-rate-limit-identifier@example.com',
      password: 'valid-pass-12345',
      name: 'Forgot Password Rate Limit User'
    })

    let sawRateLimit = false

    for (let attempt = 0; attempt < authRateLimitIdentifierMaxRequests + 2; attempt += 1) {
      const forgotPassword = await requestJson<{ accepted?: boolean; message?: string; error?: { code?: string; message?: string } }>(
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

  it('returns role-based permission maps and resolves permissions on auth/me', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'permissions-owner@example.com',
      password: 'permissions-owner-pass-12345',
      name: 'Permissions Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Permissions Team'
    })

    const mapResponse = await requestJson<Record<string, string[]>>(
      '/v1/permissions',
      'permissions-map',
      {
        method: 'GET'
      }
    )

    expect(mapResponse.response.status).toBe(200)
    expect(mapResponse.body.owner).toContain('manage_organization')
    expect(mapResponse.body.admin).toContain('manage_billing')
    expect(mapResponse.body.member).toContain('execute_workflows')

    const myPermissions = await requestJson<{ organizationId?: string; role?: string; permissions: string[] }>(
      '/v1/permissions/me',
      'permissions-me-owner',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(myPermissions.response.status).toBe(200)
    expect(myPermissions.body.organizationId).toBe(organization.id)
    expect(myPermissions.body.role).toBe('owner')
    expect(myPermissions.body.permissions).toContain('manage_organization')

    const ownerMe = await requestJson<{ organizationId?: string; permissions?: string[] }>(
      '/v1/auth/me',
      'auth-me-permissions-owner',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(ownerMe.response.status).toBe(200)
    expect(ownerMe.body.organizationId).toBe(organization.id)
    expect(ownerMe.body.permissions).toContain('manage_organization')

    const member = await createUser(factoryContext, {
      email: 'permissions-member@example.com',
      password: 'permissions-member-pass-12345',
      name: 'Permissions Member'
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

    const memberMe = await requestJson<{ organizationId?: string; permissions?: string[] }>(
      '/v1/auth/me',
      'auth-me-permissions-member',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )

    expect(memberMe.response.status).toBe(200)
    expect(memberMe.body.organizationId).toBe(organization.id)
    expect(memberMe.body.permissions).toContain('execute_workflows')
    expect(memberMe.body.permissions).not.toContain('manage_billing')
  })

  it('resolves permissions/me using the most recent organization membership', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const user = await createUser(factoryContext, {
      email: 'permissions-recent-membership@example.com',
      password: 'permissions-recent-membership-pass-12345',
      name: 'Permissions Recent Membership'
    })

    const firstOrganization = await createTeam(factoryContext, {
      token: user.token,
      name: 'Permissions First Organization'
    })

    const secondOrganization = await createTeam(factoryContext, {
      token: user.token,
      name: 'Permissions Second Organization'
    })

    expect(firstOrganization.id).not.toBe(secondOrganization.id)

    const myPermissions = await requestJson<{ organizationId?: string; role?: string; permissions: string[] }>(
      '/v1/permissions/me',
      'permissions-me-most-recent-membership',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${user.token}`
        }
      }
    )

    expect(myPermissions.response.status).toBe(200)
    expect(myPermissions.body.organizationId).toBe(secondOrganization.id)
    expect(myPermissions.body.role).toBe('owner')
    expect(myPermissions.body.permissions).toContain('manage_organization')
  })

  it('rejects permissions/me without auth and returns empty permissions without membership', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const withoutAuth = await requestJson<{ message: string }>(
      '/v1/permissions/me',
      'permissions-me-without-auth',
      {
        method: 'GET'
      }
    )

    expect(withoutAuth.response.status).toBe(401)

    const userWithoutMembership = await createUser(factoryContext, {
      email: 'permissions-no-membership@example.com',
      password: 'permissions-no-membership-pass-12345',
      name: 'Permissions No Membership'
    })

    const noMembershipPermissions = await requestJson<{
      organizationId?: string
      role?: string
      permissions: string[]
    }>(
      '/v1/permissions/me',
      'permissions-me-no-membership',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${userWithoutMembership.token}`
        }
      }
    )

    expect(noMembershipPermissions.response.status).toBe(200)
    expect(noMembershipPermissions.body.permissions).toEqual([])
    expect(noMembershipPermissions.body.organizationId).toBeUndefined()
    expect(noMembershipPermissions.body.role).toBeUndefined()
  })

  it('enforces billing authorization for unauthenticated, non-member, and member callers', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'billing-authz-owner@example.com',
      password: 'billing-authz-owner-pass-12345',
      name: 'Billing Authz Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Billing Authz Team'
    })

    const periodStart = new Date(Date.now() - (1000 * 60 * 60 * 24)).toISOString()
    const periodEnd = new Date(Date.now() + (1000 * 60 * 60 * 24)).toISOString()

    const unauthenticatedGet = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-unauth-get',
      {
        method: 'GET'
      }
    )
    expect(unauthenticatedGet.response.status).toBe(401)

    const unauthenticatedUpdate = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-unauth-update',
      {
        method: 'PATCH',
        body: JSON.stringify({
          autoRechargeEnabled: true,
          autoRechargeThresholdDecimillicents: 100_000,
          autoRechargeAmountDecimillicents: 500_000
        })
      }
    )
    expect(unauthenticatedUpdate.response.status).toBe(401)

    const unauthenticatedCheckout = await requestJson<{ message: string }>(
      '/v1/billing/checkout',
      'billing-authz-unauth-checkout',
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: organization.id,
          successUrl: 'https://app.example.com/billing/success',
          cancelUrl: 'https://app.example.com/billing/cancel'
        })
      }
    )
    expect(unauthenticatedCheckout.response.status).toBe(401)

    const unauthenticatedPortal = await requestJson<{ message: string }>(
      '/v1/billing/portal',
      'billing-authz-unauth-portal',
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )
    expect(unauthenticatedPortal.response.status).toBe(401)

    const unauthenticatedUsage = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'billing-authz-unauth-usage',
      {
        method: 'GET'
      }
    )
    expect(unauthenticatedUsage.response.status).toBe(401)

    const outsider = await createUser(factoryContext, {
      email: 'billing-authz-outsider@example.com',
      password: 'billing-authz-outsider-pass-12345',
      name: 'Billing Authz Outsider'
    })

    const outsiderGet = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-outsider-get',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${outsider.token}`
        }
      }
    )
    expect(outsiderGet.response.status).toBe(401)

    const outsiderUsage = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'billing-authz-outsider-usage',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${outsider.token}`
        }
      }
    )
    expect(outsiderUsage.response.status).toBe(401)

    const member = await createUser(factoryContext, {
      email: 'billing-authz-member@example.com',
      password: 'billing-authz-member-pass-12345',
      name: 'Billing Authz Member'
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

    const memberGet = await requestJson<{ organizationId: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-member-get',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )
    expect(memberGet.response.status).toBe(200)
    expect(memberGet.body.organizationId).toBe(organization.id)

    const memberUpdate = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-member-update',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          autoRechargeEnabled: true,
          autoRechargeThresholdDecimillicents: 100_000,
          autoRechargeAmountDecimillicents: 500_000
        })
      }
    )
    expect(memberUpdate.response.status).toBe(401)

    const memberCheckout = await requestJson<{ message: string }>(
      '/v1/billing/checkout',
      'billing-authz-member-checkout',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          successUrl: 'https://app.example.com/billing/success',
          cancelUrl: 'https://app.example.com/billing/cancel'
        })
      }
    )
    expect(memberCheckout.response.status).toBe(401)

    const memberPortal = await requestJson<{ message: string }>(
      '/v1/billing/portal',
      'billing-authz-member-portal',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )
    expect(memberPortal.response.status).toBe(401)
  })

  it('supports billing settings and checkout/portal flows', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'billing-owner@example.com',
      password: 'billing-owner-pass-12345',
      name: 'Billing Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Billing Team'
    })

    const getBilling = await requestJson<{ organizationId: string; autoRechargeEnabled: boolean }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-get-settings',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(getBilling.response.status).toBe(200)
    expect(getBilling.body.organizationId).toBe(organization.id)

    const updateBilling = await requestJson<{
      autoRechargeEnabled: boolean
      autoRechargeThresholdDecimillicents: number | null
      autoRechargeAmountDecimillicents: number | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-update-settings',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          autoRechargeEnabled: true,
          autoRechargeThresholdDecimillicents: 500_000,
          autoRechargeAmountDecimillicents: 2_000_000
        })
      }
    )

    expect(updateBilling.response.status).toBe(200)
    expect(updateBilling.body.autoRechargeEnabled).toBe(true)
    expect(updateBilling.body.autoRechargeThresholdDecimillicents).toBe(500_000)
    expect(updateBilling.body.autoRechargeAmountDecimillicents).toBe(2_000_000)

    const checkout = await requestJson<{ id: string; url: string }>(
      '/v1/billing/checkout',
      'billing-checkout',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          successUrl: 'https://app.example.com/billing/success',
          cancelUrl: 'https://app.example.com/billing/cancel'
        })
      }
    )

    expect(checkout.response.status).toBe(200)
    expect(checkout.body.id.length).toBeGreaterThan(0)
    expect(checkout.body.url.length).toBeGreaterThan(0)

    const portal = await requestJson<{ id: string; url: string }>(
      '/v1/billing/portal',
      'billing-portal',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )

    expect(portal.response.status).toBe(200)
    expect(portal.body.id.length).toBeGreaterThan(0)
    expect(portal.body.url.length).toBeGreaterThan(0)
  })

  it('rejects billing portal creation when no Stripe customer is configured', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'billing-portal-no-customer-owner@example.com',
      password: 'billing-portal-no-customer-pass-12345',
      name: 'Billing Portal No Customer Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Billing Portal No Customer Team'
    })

    const portal = await requestJson<{ message?: string }>(
      '/v1/billing/portal',
      'billing-portal-no-customer',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )

    expect(portal.response.status).toBe(400)
    expect(portal.body.message ?? '').toContain('Stripe customer is not configured')
  })

  it('rejects usage summaries with invalid date query parameters', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'billing-invalid-usage-date-owner@example.com',
      password: 'billing-invalid-usage-date-pass-12345',
      name: 'Billing Invalid Usage Date Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Billing Invalid Usage Date Team'
    })

    const invalidDate = await requestJson<{ message?: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=not-a-date&periodEnd=${encodeURIComponent(new Date().toISOString())}`,
      'billing-usage-invalid-date',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invalidDate.response.status).toBe(400)
    expect(invalidDate.body.message ?? '').toContain('Invalid periodStart date')

    const periodStart = new Date(Date.now() + (1000 * 60 * 60)).toISOString()
    const periodEnd = new Date().toISOString()

    const invalidRange = await requestJson<{ message?: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'billing-usage-invalid-range',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invalidRange.response.status).toBe(400)
    expect(invalidRange.body.message ?? '').toContain('periodEnd must be >= periodStart')
  })

  it('rejects Stripe webhooks that omit the signature header', async () => {
    const webhook = await requestJson<{ message?: string }>(
      '/v1/webhooks/stripe',
      'billing-webhook-missing-signature',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'evt_missing_signature',
          type: 'invoice.payment_succeeded',
          data: { object: {} }
        })
      }
    )

    expect(webhook.response.status).toBe(400)
    expect(webhook.body.message ?? '').toContain('Missing stripe-signature header')
  })

  it('processes stripe webhooks idempotently and syncs subscription state', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'webhook-owner@example.com',
      password: 'webhook-owner-pass-12345',
      name: 'Webhook Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Webhook Team'
    })

    const webhookPayload = {
      id: 'evt_subscription_sync_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_sync_1',
          customer: 'cus_sync_1',
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: {
            organizationId: organization.id
          },
          items: {
            data: [
              {
                id: 'si_metered_sync_1',
                price: {
                  recurring: {
                    usage_type: 'metered'
                  }
                }
              }
            ]
          }
        }
      }
    }

    const firstWebhook = await requestJson<{ processed: boolean; idempotent: boolean; eventId: string }>(
      '/v1/webhooks/stripe',
      'billing-webhook-first',
      {
        method: 'POST',
        headers: {
          'stripe-signature': 'integration-signature'
        },
        body: JSON.stringify(webhookPayload)
      }
    )

    expect(firstWebhook.response.status).toBe(200)
    expect(firstWebhook.body.processed).toBe(true)
    expect(firstWebhook.body.idempotent).toBe(false)

    const secondWebhook = await requestJson<{ processed: boolean; idempotent: boolean; eventId: string }>(
      '/v1/webhooks/stripe',
      'billing-webhook-second',
      {
        method: 'POST',
        headers: {
          'stripe-signature': 'integration-signature'
        },
        body: JSON.stringify(webhookPayload)
      }
    )

    expect(secondWebhook.response.status).toBe(200)
    expect(secondWebhook.body.processed).toBe(true)
    expect(secondWebhook.body.idempotent).toBe(true)

    const billingSettings = await requestJson<{
      isSubscribed: boolean
      subscriptionStatus: string
      stripeSubscriptionId: string | null
      stripeMeteredSubscriptionItemId: string | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-settings-after-webhook',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(billingSettings.response.status).toBe(200)
    expect(billingSettings.body.isSubscribed).toBe(true)
    expect(billingSettings.body.subscriptionStatus).toBe('active')
    expect(billingSettings.body.stripeSubscriptionId).toBe('sub_sync_1')
    expect(billingSettings.body.stripeMeteredSubscriptionItemId).toBe('si_metered_sync_1')
  })

  it('enforces subscription guard for usage summary and allows bypass when disabled', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'guard-owner@example.com',
      password: 'guard-owner-pass-12345',
      name: 'Guard Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Guard Team'
    })

    const periodStart = new Date(Date.now() - (1000 * 60 * 60 * 24)).toISOString()
    const periodEnd = new Date(Date.now() + (1000 * 60 * 60 * 24)).toISOString()

    const guardedResponse = await requestJson<{ message: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'usage-summary-guard-enabled',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(guardedResponse.response.status).toBe(401)

    const previousGuardValue = process.env.SUBSCRIPTION_GUARD_ENABLED
    process.env.SUBSCRIPTION_GUARD_ENABLED = 'false'
    const guardDisabledContext = createDbAuthContext({
      apiCwd,
      host: '127.0.0.1',
      port: apiPort + 50,
      authSecret: integrationAuthSecret,
      corsOrigin: 'http://localhost:3000',
      sql: {
        schemaPrefix: 'api_guard_disabled'
      }
    })

    try {
      await guardDisabledContext.setup()
      await guardDisabledContext.reset()

      const guardDisabledFactoryContext = guardDisabledContext.apiFactoryContext
      const guardDisabledOwner = await createUser(guardDisabledFactoryContext, {
        email: 'guard-disabled-owner@example.com',
        password: 'guard-disabled-owner-pass-12345',
        name: 'Guard Disabled Owner'
      })

      const guardDisabledOrganization = await createTeam(guardDisabledFactoryContext, {
        token: guardDisabledOwner.token,
        name: 'Guard Disabled Team'
      })

      const unguardedResponseRaw = await fetch(
        `${guardDisabledContext.baseUrl}/v1/organizations/${guardDisabledOrganization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${guardDisabledOwner.token}`,
            ...guardDisabledContext.testContext.headersForCase(
              'usage-summary-guard-disabled',
              {
                'content-type': 'application/json'
              }
            )
          }
        }
      )

      const unguardedResponse = await unguardedResponseRaw.json() as { totalQuantity: number }

      expect(unguardedResponseRaw.status).toBe(200)
      expect(unguardedResponse.totalQuantity).toBe(0)
    } finally {
      await guardDisabledContext.teardown()
      if (previousGuardValue === undefined) {
        delete process.env.SUBSCRIPTION_GUARD_ENABLED
      } else {
        process.env.SUBSCRIPTION_GUARD_ENABLED = previousGuardValue
      }
    }
  })

  it('returns aggregated usage summaries for active subscriptions', async () => {
    if (!factoryContext) {
      throw new Error('Factory context was not initialized')
    }

    const owner = await createUser(factoryContext, {
      email: 'usage-owner@example.com',
      password: 'usage-owner-pass-12345',
      name: 'Usage Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Usage Team'
    })

    const webhookPayload = {
      id: 'evt_usage_sync_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_usage_sync_1',
          customer: 'cus_usage_sync_1',
          status: 'active',
          metadata: {
            organizationId: organization.id
          },
          items: {
            data: []
          }
        }
      }
    }

    const webhook = await requestJson<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'usage-webhook-active',
      {
        method: 'POST',
        headers: {
          'stripe-signature': 'integration-signature'
        },
        body: JSON.stringify(webhookPayload)
      }
    )

    expect(webhook.response.status).toBe(200)
    expect(webhook.body.processed).toBe(true)

    const inWindowRecordedAt = new Date(Date.now() - (1000 * 60 * 30))
    const outOfWindowRecordedAt = new Date(Date.now() - (1000 * 60 * 60 * 24 * 10))

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO usage_records (
            organization_id,
            category,
            quantity,
            unit_cost_decimillicents,
            total_cost_decimillicents,
            metadata,
            recorded_at
          )
          VALUES
            ($1, 'api_call', 10, 100000, 1000000, '{}'::jsonb, $2),
            ($1, 'api_call', 99, 100000, 9900000, '{}'::jsonb, $3)
        `,
        [organization.id, inWindowRecordedAt, outOfWindowRecordedAt]
      )
    })

    const periodStart = new Date(Date.now() - (1000 * 60 * 60 * 2)).toISOString()
    const periodEnd = new Date(Date.now() + (1000 * 60 * 60)).toISOString()

    const usageSummary = await requestJson<{ totalQuantity: number; totalCostDecimillicents: number }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'usage-summary-aggregate',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(usageSummary.response.status).toBe(200)
    expect(usageSummary.body.totalQuantity).toBe(10)
    expect(usageSummary.body.totalCostDecimillicents).toBe(1_000_000)
  })
})
