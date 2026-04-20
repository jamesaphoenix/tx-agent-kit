import { and, eq } from 'drizzle-orm'
import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { authLoginIdentityRowSchema } from '../effect-schemas/auth-login-identities.js'
import { authLoginIdentities } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(authLoginIdentityRowSchema, 'auth login identity row')

export const authLoginIdentitiesRepository = {
  create: (input: {
    userId: string
    provider: AuthLoginProvider
    providerSubject: string
    email: string
    emailVerified: boolean
  }) =>
    withDb('Failed to create auth login identity', (db) =>
      Effect.gen(function* () {
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

        return yield* decodeFirst(rows, decode)
      })
    ),

  findByProviderSubject: (provider: AuthLoginProvider, providerSubject: string) =>
    withDb('Failed to find auth login identity by provider subject', (db) =>
      Effect.gen(function* () {
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

        return yield* decodeFirst(rows, decode)
      })
    ),

  findByUserProvider: (userId: string, provider: AuthLoginProvider) =>
    withDb('Failed to find auth login identity by user provider', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(authLoginIdentities)
          .where(and(eq(authLoginIdentities.userId, userId), eq(authLoginIdentities.provider, provider)))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  deleteByUserProvider: (userId: string, provider: AuthLoginProvider) =>
    withDb('Failed to delete auth login identity', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(authLoginIdentities)
          .where(and(eq(authLoginIdentities.userId, userId), eq(authLoginIdentities.provider, provider)))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    )
}
