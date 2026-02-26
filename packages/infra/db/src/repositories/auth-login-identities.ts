import { and, eq } from 'drizzle-orm'
import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  authLoginIdentityRowSchema,
  type AuthLoginIdentityRowShape
} from '../effect-schemas/auth-login-identities.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { authLoginIdentities } from '../schema.js'

const decodeAuthLoginIdentityRow = Schema.decodeUnknown(authLoginIdentityRowSchema)

const decodeNullableAuthLoginIdentity = (
  value: unknown
): Effect.Effect<AuthLoginIdentityRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeAuthLoginIdentityRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('auth login identity row decode failed', error))
  )
}

export const authLoginIdentitiesRepository = {
  create: (input: {
    userId: string
    provider: AuthLoginProvider
    providerSubject: string
    email: string
    emailVerified: boolean
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(authLoginIdentities)
          .values({
            userId: input.userId,
            provider: input.provider,
            providerSubject: input.providerSubject,
            email: input.email,
            emailVerified: input.emailVerified
          })
          .returning()
          .execute()

        return yield* decodeNullableAuthLoginIdentity(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create auth login identity', error))),

  findByProviderSubject: (provider: AuthLoginProvider, providerSubject: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(authLoginIdentities)
          .where(
            and(
              eq(authLoginIdentities.provider, provider),
              eq(authLoginIdentities.providerSubject, providerSubject)
            )
          )
          .limit(1)
          .execute()

        return yield* decodeNullableAuthLoginIdentity(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find auth login identity by provider subject', error))),

  findByUserProvider: (userId: string, provider: AuthLoginProvider) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(authLoginIdentities)
          .where(and(eq(authLoginIdentities.userId, userId), eq(authLoginIdentities.provider, provider)))
          .limit(1)
          .execute()

        return yield* decodeNullableAuthLoginIdentity(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find auth login identity by user provider', error))),

  deleteByUserProvider: (userId: string, provider: AuthLoginProvider) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(authLoginIdentities)
          .where(and(eq(authLoginIdentities.userId, userId), eq(authLoginIdentities.provider, provider)))
          .returning()
          .execute()

        return yield* decodeNullableAuthLoginIdentity(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete auth login identity', error)))
}
