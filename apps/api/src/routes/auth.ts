import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { AuthService, principalFromAuthorization } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'
import { toApiAuthPrincipal, toApiAuthSession } from '../mappers/auth-mapper.js'

export const AuthRouteKind = 'custom' as const

export const AuthLive = HttpApiBuilder.group(TxAgentApi, 'auth', (handlers) =>
  handlers
    .handle('signUp', ({ payload }) =>
      Effect.gen(function* () {
        const authService = yield* AuthService
        const session = yield* authService.signUp(payload)
        return toApiAuthSession(session)
      }).pipe(Effect.mapError(mapCoreError))
    )
    .handle('signIn', ({ payload }) =>
      Effect.gen(function* () {
        const authService = yield* AuthService
        const session = yield* authService.signIn(payload)
        return toApiAuthSession(session)
      }).pipe(Effect.mapError(mapCoreError))
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
