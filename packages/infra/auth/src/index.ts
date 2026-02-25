import bcrypt from 'bcryptjs'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import type { AuthPrincipal } from '@tx-agent-kit/contracts'
import { getAuthEnv } from './env.js'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
  message: Schema.String
}) {}

export interface SessionTokenPayload extends JWTPayload {
  sub: string
  email: string
  pwd: number
}

const encoder = new TextEncoder()

const getSecret = (): Uint8Array => {
  const env = getAuthEnv()
  const secret = env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET must be configured and at least 16 chars')
  }
  return encoder.encode(secret)
}

export const hashPassword = (plain: string): Effect.Effect<string, AuthError> =>
  Effect.tryPromise({
    try: async () => bcrypt.hash(plain, getAuthEnv().AUTH_BCRYPT_ROUNDS),
    catch: () => new AuthError({ message: 'Failed to hash password' })
  })

export const verifyPassword = (plain: string, hash: string): Effect.Effect<boolean, AuthError> =>
  Effect.tryPromise({
    try: async () => bcrypt.compare(plain, hash),
    catch: () => new AuthError({ message: 'Failed to verify password' })
  })

export const signSessionToken = (
  payload: Pick<SessionTokenPayload, 'sub' | 'email' | 'pwd'>
): Effect.Effect<string, AuthError> =>
  Effect.tryPromise({
    try: async () =>
      new SignJWT({ email: payload.email, pwd: payload.pwd })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(getSecret()),
    catch: () => new AuthError({ message: 'Failed to sign session token' })
  })

export const verifySessionToken = (token: string): Effect.Effect<SessionTokenPayload, AuthError> =>
  Effect.tryPromise({
    try: async () => {
      const { payload } = await jwtVerify(token, getSecret())
      const email = payload.email
      const pwd = payload.pwd
      if (typeof payload.sub !== 'string' || typeof email !== 'string' || typeof pwd !== 'number') {
        throw new Error('Invalid token payload')
      }
      return {
        ...payload,
        sub: payload.sub,
        email,
        pwd
      } as SessionTokenPayload
    },
    catch: () => new AuthError({ message: 'Invalid session token' })
  })

export const toPrincipal = (payload: SessionTokenPayload): AuthPrincipal => ({
  userId: payload.sub,
  email: payload.email,
  roles: ['member']
})
