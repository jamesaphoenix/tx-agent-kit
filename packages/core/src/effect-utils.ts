import { Effect } from 'effect'
import { badRequest, notFound, unauthorized, type CoreError } from './errors.js'

/**
 * Fail with NOT_FOUND if the resource's ownership field doesn't match the expected ID.
 */
export const requireOwnership = <T, K extends keyof T>(
  resource: T,
  expectedId: T[K],
  field: K,
  message: string,
  cause: unknown
): Effect.Effect<void, CoreError> =>
  resource[field] === expectedId
    ? Effect.void
    : Effect.fail(notFound(message, cause))

/**
 * Fail with UNAUTHORIZED if the role is null or the validator returns false.
 */
export const requireRole = <R>(
  role: R | null | undefined,
  validator: (r: R) => boolean,
  message: string,
  cause: unknown
): Effect.Effect<void, CoreError> =>
  role != null && validator(role)
    ? Effect.void
    : Effect.fail(unauthorized(message, cause))

/**
 * Wraps a port call with a standard mapError, converting unknown errors to BAD_REQUEST.
 */
export const withBadRequest = <A>(
  effect: Effect.Effect<A, unknown>,
  message: string
): Effect.Effect<A, CoreError> =>
  effect.pipe(Effect.mapError((cause) => badRequest(message, cause)))

/**
 * Wraps a port call with a standard mapError, converting unknown errors to UNAUTHORIZED.
 */
export const withUnauthorized = <A>(
  effect: Effect.Effect<A, unknown>,
  message: string
): Effect.Effect<A, CoreError> =>
  effect.pipe(Effect.mapError((cause) => unauthorized(message, cause)))
