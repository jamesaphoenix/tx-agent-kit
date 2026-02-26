import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  authLoginOidcStateRowSchema,
  type AuthLoginOidcStateRowShape
} from '../effect-schemas/auth-login-oidc-states.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { authLoginOidcStates } from '../schema.js'

const decodeAuthLoginOidcStateRow = Schema.decodeUnknown(authLoginOidcStateRowSchema)

const decodeNullableAuthLoginOidcState = (
  value: unknown
): Effect.Effect<AuthLoginOidcStateRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeAuthLoginOidcStateRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('auth login oidc state row decode failed', error))
  )
}

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
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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

        return yield* decodeNullableAuthLoginOidcState(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create auth login oidc state', error))),

  consumeActiveByProviderAndState: (provider: AuthLoginProvider, state: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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

        return yield* decodeNullableAuthLoginOidcState(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to consume auth login oidc state', error)))
}
