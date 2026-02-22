import type { AuthPrincipal } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import type { AuthUsersPort } from './domains/auth/ports/auth-ports.js'
import { AuthService } from './domains/auth/services/auth-service.js'
import { unauthorized, type CoreError } from './errors.js'

export const parseBearerToken = (authorization: string | undefined): Effect.Effect<string, CoreError> => {
  if (!authorization) {
    return Effect.fail(unauthorized('Missing Authorization header'))
  }

  const [scheme, token] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return Effect.fail(unauthorized('Authorization must be a Bearer token'))
  }

  return Effect.succeed(token)
}

export const principalFromAuthorization = (
  authorization: string | undefined
): Effect.Effect<AuthPrincipal, CoreError, AuthService | AuthUsersPort> =>
  Effect.gen(function* () {
    const authService = yield* AuthService
    const token = yield* parseBearerToken(authorization)
    return yield* authService.getPrincipalFromToken(token)
  })
