import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { authLoginOidcStateRowSchema } from '../effect-schemas/auth-login-oidc-states.js'
import { authLoginOidcStates } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(authLoginOidcStateRowSchema, 'auth login oidc state row')

export const authLoginOidcStatesRepository = {
  create: (input: {
    provider: AuthLoginProvider
    state: string
    nonce: string
    codeVerifier: string
    redirectUri: string
    requesterIp: string | null
    expiresAt: Date
  }) =>
    withDb('Failed to create auth login oidc state', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(authLoginOidcStates)
          .values({
            provider: input.provider,
            state: input.state,
            nonce: input.nonce,
            codeVerifier: input.codeVerifier,
            redirectUri: input.redirectUri,
            requesterIp: input.requesterIp,
            expiresAt: input.expiresAt,
            consumedAt: null
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  consumeActiveByProviderAndState: (provider: AuthLoginProvider, state: string) =>
    withDb('Failed to consume auth login oidc state', (db) =>
      Effect.gen(function* () {
        const nowExpression = sql`now()`
        const rows = yield* db
          .update(authLoginOidcStates)
          .set({
            consumedAt: nowExpression
          })
          .where(
            and(
              eq(authLoginOidcStates.provider, provider),
              eq(authLoginOidcStates.state, state),
              isNull(authLoginOidcStates.consumedAt),
              gt(authLoginOidcStates.expiresAt, nowExpression)
            )
          )
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  pruneExpired: (olderThan: Date) =>
    withDb('Failed to prune expired auth login oidc states', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(authLoginOidcStates)
          .where(
            or(
              lt(authLoginOidcStates.expiresAt, olderThan),
              lt(authLoginOidcStates.consumedAt, olderThan)
            )
          )
          .returning({ id: authLoginOidcStates.id })
          .execute()

        return rows.length
      })
    )
}
