import { authLoginOidcStatesRepository } from '@tx-agent-kit/db'
import { GoogleOidcPort } from '@tx-agent-kit/core'
import { Effect, Layer } from 'effect'
import { Issuer, generators, type Client } from 'openid-client'
import { getGoogleOidcConfig } from '../config/env.js'

const oidcStateTtlMs = 10 * 60 * 1000

interface GoogleOidcRuntime {
  client: Client
  callbackUrl: string
}

let cachedRuntime: Promise<GoogleOidcRuntime> | null = null
let cachedRuntimeKey = ''

const resolveRuntimeKey = (): string => {
  const config = getGoogleOidcConfig()
  if (!config) {
    throw new Error('Google OIDC is not configured.')
  }

  return [
    config.issuerUrl,
    config.clientId,
    config.clientSecret,
    config.callbackUrl
  ].join('|')
}

const getGoogleOidcRuntime = async (): Promise<GoogleOidcRuntime> => {
  const config = getGoogleOidcConfig()
  if (!config) {
    throw new Error('Google OIDC is not configured.')
  }

  const runtimeKey = resolveRuntimeKey()
  if (!cachedRuntime || cachedRuntimeKey !== runtimeKey) {
    cachedRuntimeKey = runtimeKey
    cachedRuntime = (async () => {
      const issuer = await Issuer.discover(config.issuerUrl)
      const client = new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.callbackUrl],
        response_types: ['code']
      })

      return {
        client,
        callbackUrl: config.callbackUrl
      }
    })()
  }

  return cachedRuntime
}

const normalizeEmailVerified = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }

  if (typeof value === 'number') {
    return value === 1
  }

  return false
}

export const GoogleOidcPortLive = Layer.succeed(GoogleOidcPort, {
  startAuthorization: (input: { ipAddress: string | null }) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.tryPromise({
        try: () => getGoogleOidcRuntime(),
        catch: () => new Error('Failed to initialize Google OIDC client')
      })

      const state = generators.state()
      const nonce = generators.nonce()
      const codeVerifier = generators.codeVerifier()
      const codeChallenge = generators.codeChallenge(codeVerifier)
      const expiresAt = new Date(Date.now() + oidcStateTtlMs)

      const created = yield* authLoginOidcStatesRepository.create({
        provider: 'google',
        state,
        nonce,
        codeVerifier,
        redirectUri: runtime.callbackUrl,
        requesterIp: input.ipAddress,
        expiresAt
      }).pipe(Effect.mapError(() => new Error('Failed to persist Google OIDC state')))

      if (!created) {
        return yield* Effect.fail(new Error('Failed to persist Google OIDC state'))
      }

      const authorizationUrl = runtime.client.authorizationUrl({
        scope: 'openid email profile',
        response_type: 'code',
        redirect_uri: runtime.callbackUrl,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })

      return {
        authorizationUrl,
        state,
        expiresAt
      }
    }),

  completeAuthorization: (input: { code: string; state: string }) =>
    Effect.gen(function* () {
      const consumedState = yield* authLoginOidcStatesRepository
        .consumeActiveByProviderAndState('google', input.state)
        .pipe(Effect.mapError(() => new Error('Failed to consume Google OIDC state')))

      if (!consumedState) {
        return yield* Effect.fail(new Error('Invalid or expired Google OIDC state'))
      }

      const runtime = yield* Effect.tryPromise({
        try: () => getGoogleOidcRuntime(),
        catch: () => new Error('Failed to initialize Google OIDC client')
      })

      const tokenSet = yield* Effect.tryPromise({
        try: () =>
          runtime.client.callback(
            runtime.callbackUrl,
            {
              code: input.code,
              state: consumedState.state
            },
            {
              nonce: consumedState.nonce,
              state: consumedState.state,
              code_verifier: consumedState.codeVerifier
            }
          ),
        catch: () => new Error('Failed to complete Google OIDC callback')
      })

      const claims = tokenSet.claims()
      const subject = claims.sub
      const email = claims.email
      const name = claims.name

      if (typeof subject !== 'string' || typeof email !== 'string') {
        return yield* Effect.fail(new Error('Google OIDC callback did not include required claims'))
      }

      return {
        provider: 'google' as const,
        providerSubject: subject,
        email,
        emailVerified: normalizeEmailVerified(claims.email_verified),
        name: typeof name === 'string' ? name : email
      }
    })
})
