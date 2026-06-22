import bcrypt from 'bcryptjs'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import type { AuthPrincipal } from '@tx-agent-kit/contracts'
import { getAuthEnv } from './env.js'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export interface SessionTokenPayload extends JWTPayload {
  sub: string
  email: string
  pwd: number
  sid: string
}

const encoder = new TextEncoder()

const getSecret = (): Uint8Array => {
  const env = getAuthEnv()
  const secret = env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be configured and at least 32 characters (256 bits)')
  }
  return encoder.encode(secret)
}

export const hashPassword = (plain: string): Effect.Effect<string, AuthError> =>
  Effect.tryPromise({
    try: async () => bcrypt.hash(plain, getAuthEnv().AUTH_BCRYPT_ROUNDS),
    catch: (cause) => new AuthError({ message: 'Failed to hash password', cause })
  })

export const verifyPassword = (plain: string, hash: string): Effect.Effect<boolean, AuthError> =>
  Effect.tryPromise({
    try: async () => bcrypt.compare(plain, hash),
    catch: (cause) => new AuthError({ message: 'Failed to verify password', cause })
  })

export const signSessionToken = (
  payload: Pick<SessionTokenPayload, 'sub' | 'email' | 'pwd' | 'sid'>
): Effect.Effect<string, AuthError> =>
  Effect.tryPromise({
    try: async () =>
      new SignJWT({ email: payload.email, pwd: payload.pwd, sid: payload.sid })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime(getAuthEnv().AUTH_ACCESS_TOKEN_TTL)
        .sign(getSecret()),
    catch: (error) => new AuthError({ message: `Failed to sign session token: ${error instanceof Error ? error.message : String(error)}` })
  })

// NOTE: The catch handler above intentionally includes the original error message.
// This was added after a debugging session where AUTH_SECRET was too short (28 chars < 32 minimum)
// and the error was silently swallowed, producing an opaque "Failed to create access token"
// error with no indication of the root cause.

export const verifySessionToken = (token: string): Effect.Effect<SessionTokenPayload, AuthError> =>
  Effect.tryPromise({
    try: async () => {
      const { payload } = await jwtVerify(token, getSecret())
      const email = payload.email
      const pwd = payload.pwd
      const sid = payload.sid
      if (typeof payload.sub !== 'string' || typeof email !== 'string' || typeof pwd !== 'number' || typeof sid !== 'string') {
        throw new Error('Invalid token payload')
      }
      return {
        ...payload,
        sub: payload.sub,
        email,
        pwd,
        sid
      }
    },
    catch: (cause) => new AuthError({ message: 'Invalid session token', cause })
  })

/**
 * Returns a partial principal from token claims only. Does NOT include actual
 * roles/permissions — use AuthService.getPrincipalFromToken for full principal
 * resolution.
 */
export const toPartialPrincipal = (payload: SessionTokenPayload): AuthPrincipal => ({
  userId: payload.sub,
  email: payload.email,
  roles: ['member'],
  permissions: []
})
