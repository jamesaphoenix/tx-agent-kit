import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { AuthService, principalFromAuthorization } from '@tx-agent-kit/core'
import type { AuthRateLimitedPath } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { TooManyRequests, TxAgentApi, mapCoreError } from '../api.js'
import { consumeAuthIdentifierRateLimit, toClientIpAddress } from '../middleware/auth-rate-limit.js'
import { toApiAuthPrincipal, toApiAuthSession } from '../mappers/auth-mapper.js'

export const AuthRouteKind = 'custom' as const

const toAuthRequestContext = (request: HttpServerRequest.HttpServerRequest): {
  ipAddress?: string
  userAgent?: string
} => {
  const userAgent = request.headers['user-agent']

  return {
    ipAddress: toClientIpAddress(request),
    userAgent: typeof userAgent === 'string' && userAgent.length > 0 ? userAgent : undefined
  }
}

const isTooManyRequests = (error: unknown): error is TooManyRequests => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const tag = '_tag' in error ? (error as { _tag?: unknown })._tag : undefined
  return tag === 'TooManyRequests'
}

const mapAuthError = (error: unknown) =>
  isTooManyRequests(error)
    ? error
    : mapCoreError(error)

const enforceIdentifierRateLimit = (
  path: AuthRateLimitedPath,
  identifier: string
): Effect.Effect<void, TooManyRequests> => {
  const decision = consumeAuthIdentifierRateLimit(path, identifier)

  if (!decision.limited) {
    return Effect.void
  }

  return Effect.fail(
    new TooManyRequests({ message: 'Too many authentication attempts. Please try again later.' })
  )
}

export const AuthLive = HttpApiBuilder.group(TxAgentApi, 'auth', (handlers) =>
  handlers
    .handle('signUp', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authService = yield* AuthService
        const session = yield* authService.signUp(payload, toAuthRequestContext(request))
        return toApiAuthSession(session)
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('signIn', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* enforceIdentifierRateLimit('/v1/auth/sign-in', payload.email)
        const authService = yield* AuthService
        const session = yield* authService.signIn(payload, toAuthRequestContext(request))
        return toApiAuthSession(session)
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('refreshSession', ({ payload }) =>
      Effect.gen(function* () {
        const authService = yield* AuthService
        const session = yield* authService.refreshSession(payload)
        return toApiAuthSession(session)
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('signOut', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const authService = yield* AuthService
        return yield* authService.signOutSession(principal)
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('signOutAll', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const authService = yield* AuthService
        return yield* authService.signOutAllSessions(principal)
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('googleStart', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authService = yield* AuthService
        const started = yield* authService.startGoogleAuth({
          ipAddress: toClientIpAddress(request)
        })

        return {
          authorizationUrl: started.authorizationUrl,
          state: started.state,
          expiresAt: started.expiresAt.toISOString()
        }
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('googleCallback', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authService = yield* AuthService
        const session = yield* authService.completeGoogleAuth({
          code: urlParams.code,
          state: urlParams.state,
          ...toAuthRequestContext(request)
        })

        return toApiAuthSession(session)
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('forgotPassword', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* enforceIdentifierRateLimit('/v1/auth/forgot-password', payload.email)
        const authService = yield* AuthService
        return yield* authService.requestPasswordReset(payload, toAuthRequestContext(request))
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('resetPassword', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authService = yield* AuthService
        return yield* authService.resetPassword(payload, toAuthRequestContext(request))
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('me', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )

        return toApiAuthPrincipal(principal)
      })
    )
    .handle('deleteMe', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const authService = yield* AuthService
        return yield* authService.deleteUser(principal).pipe(Effect.mapError(mapCoreError))
      })
    )
)
