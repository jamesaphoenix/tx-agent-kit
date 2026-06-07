import { authLoginOidcStatesRepository } from '@tx-agent-kit/db'
import { GoogleOidcPort } from '@tx-agent-kit/core'
import { describeCauseForLog } from '@tx-agent-kit/observability'
import { Effect, Layer, Option } from 'effect'
import * as oidc from 'openid-client'
import { getGoogleOidcConfig } from '../config/env.js'

const oidcStateTtlMs = 10 * 60 * 1000

interface GoogleOidcRuntime {
  configuration: oidc.Configuration
  callbackUrl: string
}

type OidcConfigurationMutator = (configuration: oidc.Configuration) => void

interface OidcLocalTestingExports {
  allowInsecureRequests: OidcConfigurationMutator
}

let cachedRuntime: Promise<GoogleOidcRuntime> | null = null
let cachedRuntimeKey = ''

const allowHttpOidcDiscoveryForLocal = (): OidcConfigurationMutator =>
  (oidc as OidcLocalTestingExports)['allowInsecureRequests']

const wrapOidcError = (message: string, cause: unknown): Error =>
  new Error(`${message}: ${describeCauseForLog(cause)}`, { cause })

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
      try {
        const discoveryOptions = config.issuerUrl.startsWith('http://')
          ? { execute: [allowHttpOidcDiscoveryForLocal()] }
          : undefined
        const configuration = await oidc.discovery(
          new URL(config.issuerUrl),
          config.clientId,
          {
            client_secret: config.clientSecret,
            token_endpoint_auth_method: 'client_secret_post',
            redirect_uris: [config.callbackUrl],
            response_types: ['code']
          },
          oidc.ClientSecretPost(config.clientSecret),
          discoveryOptions
        )

        return {
          configuration,
          callbackUrl: config.callbackUrl
        }
      } catch (error) {
        cachedRuntime = null
        throw error
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
  startAuthorization: (input: { ipAddress: string | null; statePrefix?: string }) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.tryPromise({
        try: () => getGoogleOidcRuntime(),
        catch: (cause) => new Error(`Failed to initialize Google OIDC client: ${cause instanceof Error ? cause.message : String(cause)}`)
      })

      const state = `${input.statePrefix ?? ''}${oidc.randomState()}`
      const nonce = ''
      const codeVerifier = oidc.randomPKCECodeVerifier()
      const codeChallenge = yield* Effect.tryPromise({
        try: () => oidc.calculatePKCECodeChallenge(codeVerifier),
        catch: (cause) =>
          new Error(`Failed to calculate PKCE code challenge: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
      const expiresAt = new Date(Date.now() + oidcStateTtlMs)

      yield* authLoginOidcStatesRepository.create({
        provider: 'google',
        state,
        nonce,
        codeVerifier,
        redirectUri: runtime.callbackUrl,
        requesterIp: input.ipAddress,
        expiresAt
      }).pipe(
        Effect.mapError((cause) => new Error(`Failed to persist Google OIDC state: ${cause instanceof Error ? cause.message : String(cause)}`)),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(new Error('Failed to persist Google OIDC state')),
          onSome: Effect.succeed
        }))
      )

      const authorizationUrl = oidc.buildAuthorizationUrl(runtime.configuration, {
        scope: 'openid email profile',
        response_type: 'code',
        redirect_uri: runtime.callbackUrl,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })

      return {
        authorizationUrl: authorizationUrl.href,
        state,
        expiresAt
      }
    }),

  completeAuthorization: (input: { code: string; state: string; iss?: string }) =>
    Effect.gen(function* () {
      const consumedState = yield* authLoginOidcStatesRepository
        .consumeActiveByProviderAndState('google', input.state)
        .pipe(
          Effect.mapError((cause) => new Error(`Failed to consume Google OIDC state: ${cause instanceof Error ? cause.message : String(cause)}`)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new Error('Invalid or expired Google OIDC state')),
            onSome: Effect.succeed
          }))
        )

      const runtime = yield* Effect.tryPromise({
        try: () => getGoogleOidcRuntime(),
        catch: (cause) => new Error(`Failed to initialize Google OIDC client: ${cause instanceof Error ? cause.message : String(cause)}`)
      })

      const currentUrl = new URL(consumedState.redirectUri)
      currentUrl.searchParams.set('code', input.code)
      currentUrl.searchParams.set('state', consumedState.state)
      if (input.iss !== undefined) {
        currentUrl.searchParams.set('iss', input.iss)
      }

      const tokenSet = yield* Effect.tryPromise({
        try: () =>
          oidc.authorizationCodeGrant(runtime.configuration, currentUrl, {
            expectedState: consumedState.state,
            idTokenExpected: true,
            pkceCodeVerifier: consumedState.codeVerifier
          }),
        catch: (cause) => wrapOidcError('Failed to complete Google OIDC callback', cause)
      })

      const claims = tokenSet.claims()
      if (!claims) {
        return yield* Effect.fail(new Error('Google OIDC callback did not include an ID token'))
      }

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
