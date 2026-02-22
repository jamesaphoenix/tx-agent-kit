import { Context } from 'effect'
import type * as Effect from 'effect/Effect'

export const AuthRepositoryKind = 'custom' as const

export interface AuthUserRecord {
  id: string
  email: string
  passwordHash: string
  name: string
  createdAt: Date
}

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
