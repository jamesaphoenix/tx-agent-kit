import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { AuthService, principalFromAuthorization } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'

export const AuthLive = HttpApiBuilder.group(TxAgentApi, 'auth', (handlers) =>
  handlers
    .handle('signUp', ({ payload }) =>
      Effect.gen(function* () {
        const authService = yield* AuthService
        return yield* authService.signUp(payload)
      }).pipe(Effect.mapError(mapCoreError))
    )
    .handle('signIn', ({ payload }) =>
      Effect.gen(function* () {
        const authService = yield* AuthService
        return yield* authService.signIn(payload)
      }).pipe(Effect.mapError(mapCoreError))
    )
    .handle('me', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authorization = request.headers.authorization
        const authService = yield* AuthService

        if (!authorization) {
          return yield* Effect.fail(mapCoreError({ _tag: 'CoreError', code: 'UNAUTHORIZED', message: 'Missing authorization header' }))
        }

        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization
        const principal = yield* authService.getPrincipalFromToken(token).pipe(Effect.mapError(mapCoreError))
        return principal
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
