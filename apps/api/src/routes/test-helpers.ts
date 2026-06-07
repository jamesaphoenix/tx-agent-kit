import {
  browserAuthSessionModeHeaderName,
  browserAuthSessionModeHeaderValue
} from '@tx-agent-kit/contracts'
import { createDbAuthContext, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportJWK, SignJWT, type JWK } from 'jose'
import { afterAll, beforeAll, beforeEach } from 'vitest'

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

export const healthReadinessLatencyBudgetMs = parsePositiveInt(
  process.env.API_HEALTH_READINESS_MAX_LATENCY_MS,
 1500
)
export const healthBurstRequestCount = parsePositiveInt(
  process.env.API_HEALTH_BURST_REQUEST_COUNT,
  20
)
export const healthBurstLatencyBudgetMs = parsePositiveInt(
  process.env.API_HEALTH_BURST_MAX_LATENCY_MS,
  20_000
)
export const authRateLimitWindowMs = parsePositiveInt(
  process.env.API_AUTH_RATE_LIMIT_WINDOW_MS,
  60_000
)
export const authRateLimitMaxRequests = parsePositiveInt(
  process.env.API_AUTH_RATE_LIMIT_MAX_REQUESTS,
  200
)
export const authRateLimitIdentifierMaxRequests = parsePositiveInt(
  process.env.API_AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS,
  authRateLimitMaxRequests
)

export const integrationAuthSecret = 'integration-auth-secret-minimum-32-chars'

export const apiCwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const browserCookieAuthHeaders = {
  [browserAuthSessionModeHeaderName]: browserAuthSessionModeHeaderValue,
  origin: 'http://localhost:3000'
} as const

interface OidcAuthorizationCodeRecord {
  clientId: string
  redirectUri: string
  codeChallenge: string
  nonce: string
}

export interface OidcTestProvider {
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

const decodeBasicCredential = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null
  }

  try {
    return decodeURIComponent(value.replaceAll('+', '%20'))
  } catch {
    return value
  }
}

export const createOidcTestProvider = async (input: {
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

          // Real Google appends the `iss` (issuer) response parameter so the
          // client can validate the authorization response origin. Mirror that
          // here so issuer-validation paths are exercised.
          response.statusCode = 302
          response.setHeader(
            'location',
            `${redirectUri}?code=${encodeURIComponent(authorizationCode)}&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(issuerUrl)}`
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
            requestedClientId = decodeBasicCredential(basicClientId)
            requestedClientSecret = decodeBasicCredential(basicClientSecret)
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
          if (codeRecord?.redirectUri !== redirectUri || codeRecord.clientId !== requestedClientId) {
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

export const readCookieHeader = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie')

  if (!setCookie) {
    throw new Error('Expected Set-Cookie header to be present')
  }

  const cookieHeader = setCookie.split(';', 1)[0]
  if (!cookieHeader) {
    throw new Error(`Expected cookie header value, received: ${setCookie}`)
  }

  return cookieHeader
}

export interface RequestJsonResult<T> {
  response: Response
  body: T
}

export const requestJson = async <T>(
  dbAuthContext: ReturnType<typeof createDbAuthContext>,
  path: string,
  caseName: string,
  init?: RequestInit
): Promise<RequestJsonResult<T>> => {
  const existingHeaders: Record<string, string> = {}
  if (init?.headers) {
    const h = new Headers(init.headers)
    h.forEach((value, key) => { existingHeaders[key] = value })
  }
  const response = await fetch(`${dbAuthContext.baseUrl}${path}`, {
    ...init,
    headers: dbAuthContext.testContext.headersForCase(caseName, {
      'content-type': 'application/json',
      ...existingHeaders
    })
  })

  const body = await response.json() as T
  return { response, body }
}

export type RequestHelper = <T>(path: string, caseName: string, init?: RequestInit) => Promise<RequestJsonResult<T>>

export const createRequestHelper = (
  ctx: ReturnType<typeof createDbAuthContext>
): RequestHelper =>
  (path, caseName, init) => requestJson(ctx, path, caseName, init)

export interface TestFixture {
  dbAuthContext: ReturnType<typeof createDbAuthContext>
  request: RequestHelper
  getFactoryContext: () => ApiFactoryContext
  hooks: {
    beforeAll: () => Promise<void>
    beforeEach: () => Promise<void>
    afterAll: () => Promise<void>
  }
}

export const createTestFixture = (options?: {
  schemaPrefix?: string
  autoRegisterHooks?: boolean
  apiPort?: number
}): TestFixture => {
  const authSecret = process.env.INTEGRATION_AUTH_SECRET ?? 'integration-shared-auth-secret-32ch'
  if ((process.env.AUTH_SECRET ?? '').length < 32) {
    process.env.AUTH_SECRET = authSecret
  }

  // Point at the shared server by default. Tests that need process-local env
  // injection can pass an explicit port to spawn a dedicated API process.
  const dbAuthContext = createDbAuthContext({
    apiCwd,
    port: options?.apiPort,
    authSecret,
    corsOrigin: 'http://localhost:3000',
    sql: {
      schemaPrefix: options?.schemaPrefix ?? 'api_test'
    }
  })

  let factoryContext: ApiFactoryContext | undefined

  const request = createRequestHelper(dbAuthContext)

  const hooks = {
    beforeAll: async () => {
      await dbAuthContext.setup()
    },
    beforeEach: async () => {
      await dbAuthContext.reset()
      factoryContext = dbAuthContext.apiFactoryContext
    },
    afterAll: async () => {
      await dbAuthContext.teardown()
    }
  }

  if (options?.autoRegisterHooks !== false) {
    beforeAll(async () => {
      await hooks.beforeAll()
    })

    beforeEach(async () => {
      await hooks.beforeEach()
    })

    afterAll(async () => {
      await hooks.afterAll()
    })
  }

  return {
    dbAuthContext,
    request,
    getFactoryContext: () => {
      if (!factoryContext) {
        throw new Error('Factory context was not initialized — ensure beforeEach has run')
      }
      return factoryContext
    },
    hooks
  }
}
