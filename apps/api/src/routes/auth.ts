import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { AuthService, principalFromAuthorization, type AuthSession } from '@tx-agent-kit/core'
import {
  browserAuthSessionModeHeaderName,
  browserAuthSessionModeHeaderValue,
  refreshSessionRequestSchema,
  signInRequestSchema,
  signUpRequestSchema,
  type AuthRateLimitedPath,
  type RefreshSessionRequest
} from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { TooManyRequests, TxAgentApi, Unauthorized, mapCoreError } from '../api.js'
import { getAuthRefreshCookieConfig } from '../config/env.js'
import { consumeAuthIdentifierRateLimit, toClientIpAddress } from '../middleware/auth-rate-limit.js'
import { toApiAuthPrincipal, toApiAuthSession } from '../mappers/auth-mapper.js'
import { requireAuth } from '../utils.js'

export const AuthRouteKind = 'custom' as const

const toAuthRequestContext = (
  request: HttpServerRequest.HttpServerRequest
): {
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

const isUnauthorized = (error: unknown): error is Unauthorized => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const tag = '_tag' in error ? (error as { _tag?: unknown })._tag : undefined
  return tag === 'Unauthorized'
}

const mapAuthError = (error: unknown) =>
  isTooManyRequests(error)
    ? error
    : mapCoreError(error)

const isCookieManagedBrowserSessionRequest = (
  request: HttpServerRequest.HttpServerRequest
): boolean => {
  const sessionMode = request.headers[browserAuthSessionModeHeaderName]

  return sessionMode === browserAuthSessionModeHeaderValue
}

const cookieManagedGoogleAuthStatePrefix = 'bc_'

const isCookieManagedGoogleAuthState = (state: string): boolean =>
  state.startsWith(cookieManagedGoogleAuthStatePrefix)

const toGoogleAuthStatePrefix = (
  request: HttpServerRequest.HttpServerRequest
): string =>
  isCookieManagedBrowserSessionRequest(request) ? cookieManagedGoogleAuthStatePrefix : ''

const renderJson = (
  body: unknown,
  status?: number
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.unsafeJson(body, status === undefined ? undefined : { status })

const withRefreshCookie = (
  response: HttpServerResponse.HttpServerResponse,
  refreshToken: string
): HttpServerResponse.HttpServerResponse => {
  const cookieConfig = getAuthRefreshCookieConfig()
  return HttpServerResponse.unsafeSetCookie(
    response,
    cookieConfig.name,
    refreshToken,
    cookieConfig.options
  )
}

const withRefreshCookieExpired = (
  response: HttpServerResponse.HttpServerResponse
): HttpServerResponse.HttpServerResponse => {
  const cookieConfig = getAuthRefreshCookieConfig()
  return HttpServerResponse.expireCookie(
    response,
    cookieConfig.name,
    cookieConfig.options
  )
}

const renderAuthSessionResponse = (
  session: AuthSession,
  options: {
    includeRefreshToken?: boolean
    isBrowserSession?: boolean
    status?: number
  } = {}
): HttpServerResponse.HttpServerResponse => {
  const body = toApiAuthSession(session, {
    includeRefreshToken: options.includeRefreshToken
  })

  const response = renderJson(body, options.status)
  if (options.isBrowserSession) {
    return withRefreshCookie(response, session.refreshToken)
  }

  return response
}

const renderUnauthorizedAuthResponse = (
  message: string
): HttpServerResponse.HttpServerResponse =>
  withRefreshCookieExpired(renderJson({ message }, 401))

// Cookie refresh token takes precedence over body — browser-managed sessions
// use httpOnly cookies, while non-browser clients send the token in the body.
const resolveRefreshToken = (
  request: HttpServerRequest.HttpServerRequest,
  payload: RefreshSessionRequest
): string | null => {
  const cookieConfig = getAuthRefreshCookieConfig()
  const cookieRefreshToken = request.cookies[cookieConfig.name]

  if (typeof cookieRefreshToken === 'string' && cookieRefreshToken.length > 0) {
    return cookieRefreshToken
  }

  if (typeof payload.refreshToken === 'string' && payload.refreshToken.length > 0) {
    return payload.refreshToken
  }

  return null
}

const catchUnauthorizedWithExpiredCookie = (
  error: unknown
): Effect.Effect<HttpServerResponse.HttpServerResponse, TooManyRequests | ReturnType<typeof mapCoreError>> => {
  const mappedError = mapAuthError(error)

  if (isUnauthorized(mappedError)) {
    return Effect.succeed(renderUnauthorizedAuthResponse(mappedError.message))
  }

  return Effect.fail(mappedError)
}

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

export const AuthLive = HttpApiBuilder.group(TxAgentApi, 'auth', (handlers) => {
  return handlers
    .handleRaw('signUp', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const payload = yield* HttpServerRequest.schemaBodyJson(signUpRequestSchema).pipe(
          Effect.mapError(mapCoreError)
        )
        yield* enforceIdentifierRateLimit('/v1/auth/sign-up', payload.email)
        const authService = yield* AuthService
        const session = yield* authService.signUp(payload, toAuthRequestContext(request))
        const isBrowser = isCookieManagedBrowserSessionRequest(request)
        return renderAuthSessionResponse(session, {
          includeRefreshToken: !isBrowser,
          isBrowserSession: isBrowser,
          status: 201
        })
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handleRaw('signIn', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const payload = yield* HttpServerRequest.schemaBodyJson(signInRequestSchema).pipe(
          Effect.mapError(mapCoreError)
        )
        yield* enforceIdentifierRateLimit('/v1/auth/sign-in', payload.email)
        const authService = yield* AuthService
        const session = yield* authService.signIn(payload, toAuthRequestContext(request))
        const isBrowserSignIn = isCookieManagedBrowserSessionRequest(request)
        return renderAuthSessionResponse(session, {
          includeRefreshToken: !isBrowserSignIn,
          isBrowserSession: isBrowserSignIn
        })
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handleRaw('refreshSession', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const payload = yield* HttpServerRequest.schemaBodyJson(refreshSessionRequestSchema).pipe(
          Effect.mapError(mapCoreError)
        )
        const authService = yield* AuthService
        const refreshToken = resolveRefreshToken(request, payload)

        if (refreshToken === null) {
          return yield* Effect.fail(new Unauthorized({ message: 'Invalid refresh token' }))
        }

        yield* enforceIdentifierRateLimit('/v1/auth/refresh', refreshToken)

        const session = yield* authService.refreshSession({ refreshToken })
        const isBrowserRefresh = isCookieManagedBrowserSessionRequest(request)
        return renderAuthSessionResponse(session, {
          includeRefreshToken: !isBrowserRefresh,
          isBrowserSession: isBrowserRefresh
        })
      }).pipe(Effect.catchAll(catchUnauthorizedWithExpiredCookie))
    )
    // Cannot use requireAuth here — signOut uses catchUnauthorizedWithExpiredCookie to
    // expire the refresh cookie on auth failure, which requireAuth's mapCoreError would bypass.
    .handleRaw('signOut', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization)
        const authService = yield* AuthService
        const response = yield* authService.signOutSession(principal)
        return withRefreshCookieExpired(renderJson(response))
      }).pipe(Effect.catchAll(catchUnauthorizedWithExpiredCookie))
    )
    // Cannot use requireAuth here — signOutAll uses catchUnauthorizedWithExpiredCookie to
    // expire the refresh cookie on auth failure, which requireAuth's mapCoreError would bypass.
    .handleRaw('signOutAll', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization)
        const authService = yield* AuthService
        const response = yield* authService.signOutAllSessions(principal)
        return withRefreshCookieExpired(renderJson(response))
      }).pipe(Effect.catchAll(catchUnauthorizedWithExpiredCookie))
    )
    .handle('googleStart', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authService = yield* AuthService
        const started = yield* authService.startGoogleAuth({
          ipAddress: toClientIpAddress(request),
          statePrefix: toGoogleAuthStatePrefix(request)
        })

        return {
          authorizationUrl: started.authorizationUrl,
          state: started.state,
          expiresAt: started.expiresAt.toISOString()
        }
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handleRaw('googleCallback', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authService = yield* AuthService
        const session = yield* authService.completeGoogleAuth({
          code: urlParams.code,
          state: urlParams.state,
          ...toAuthRequestContext(request)
        })

        const isBrowserGoogle = isCookieManagedGoogleAuthState(urlParams.state)
        return renderAuthSessionResponse(session, {
          includeRefreshToken: !isBrowserGoogle,
          isBrowserSession: isBrowserGoogle
        })
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
        yield* enforceIdentifierRateLimit('/v1/auth/reset-password', payload.token)
        const authService = yield* AuthService
        return yield* authService.resetPassword(payload, toAuthRequestContext(request))
      }).pipe(Effect.mapError(mapAuthError))
    )
    .handle('me', () =>
      Effect.gen(function* () {
        const principal = yield* requireAuth

        return toApiAuthPrincipal(principal)
      }).pipe(Effect.mapError(mapAuthError))
    )
    // Cannot use requireAuth here — deleteMe uses catchUnauthorizedWithExpiredCookie to
    // expire the refresh cookie on auth failure, which requireAuth's mapCoreError would bypass.
    .handleRaw('deleteMe', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization)
        const authService = yield* AuthService
        const response = yield* authService.deleteUser(principal)
        return withRefreshCookieExpired(renderJson(response))
      }).pipe(Effect.catchAll(catchUnauthorizedWithExpiredCookie))
    )
})
