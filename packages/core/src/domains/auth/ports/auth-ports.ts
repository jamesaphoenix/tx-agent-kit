import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { AuthSessionTokenPayload, AuthUserRecord } from '../domain/auth-domain.js'

export const AuthRepositoryKind = 'custom' as const

export type { AuthSessionTokenPayload, AuthUserRecord }

export class AuthUsersPort extends Context.Tag('AuthUsersPort')<
  AuthUsersPort,
  {
    create: (input: { email: string; passwordHash: string; name: string }) => Effect.Effect<AuthUserRecord | null, unknown>
    findByEmail: (email: string) => Effect.Effect<AuthUserRecord | null, unknown>
    findById: (id: string) => Effect.Effect<AuthUserRecord | null, unknown>
    deleteById: (id: string) => Effect.Effect<AuthUserRecord | null, unknown>
  }
>() {}

export class AuthWorkspaceOwnershipPort extends Context.Tag('AuthWorkspaceOwnershipPort')<
  AuthWorkspaceOwnershipPort,
  {
    countOwnedByUser: (userId: string) => Effect.Effect<number, unknown>
  }
>() {}

export class PasswordHasherPort extends Context.Tag('PasswordHasherPort')<
  PasswordHasherPort,
  {
    hash: (plainText: string) => Effect.Effect<string, unknown>
    verify: (plainText: string, hash: string) => Effect.Effect<boolean, unknown>
  }
>() {}

export class SessionTokenPort extends Context.Tag('SessionTokenPort')<
  SessionTokenPort,
  {
    sign: (payload: Pick<AuthSessionTokenPayload, 'sub' | 'email'>) => Effect.Effect<string, unknown>
    verify: (token: string) => Effect.Effect<AuthSessionTokenPayload, unknown>
  }
>() {}
