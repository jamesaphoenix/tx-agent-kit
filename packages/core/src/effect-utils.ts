import { Effect } from 'effect'
import { internalError, notFound, unauthorized, type CoreError } from './errors.js'

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
 * Wraps a port/repository call with a standard mapError, converting an unknown
 * INFRA failure to INTERNAL_ERROR (500) — which is always logged + sent to
 * Sentry at the API boundary. Use this for "Failed to <verb>" seam failures; a
 * port call failing is a server fault, NOT a client error.
 *
 * NOTE: the older `withBadRequest`/`withUnauthorized` helpers were removed — a
 * repository/port-call failure is never a 4xx. Genuine client errors should be
 * raised explicitly with `badRequest(...)`/`unauthorized(...)` from a business
 * check, not by wrapping a port call.
 */
export const withInternalError = <A>(
  effect: Effect.Effect<A, unknown>,
  message: string
): Effect.Effect<A, CoreError> =>
  effect.pipe(Effect.mapError((cause) => internalError(message, cause)))
