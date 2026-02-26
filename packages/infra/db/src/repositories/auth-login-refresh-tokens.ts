import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  authLoginRefreshTokenRowSchema,
  type AuthLoginRefreshTokenRowShape
} from '../effect-schemas/auth-login-refresh-tokens.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { authLoginRefreshTokens } from '../schema.js'

const decodeAuthLoginRefreshTokenRow = Schema.decodeUnknown(authLoginRefreshTokenRowSchema)

const decodeNullableAuthLoginRefreshToken = (
  value: unknown
): Effect.Effect<AuthLoginRefreshTokenRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeAuthLoginRefreshTokenRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('auth login refresh token row decode failed', error))
  )
}

export const authLoginRefreshTokensRepository = {
  create: (input: { sessionId: string; tokenHash: string; expiresAt: Date }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(authLoginRefreshTokens)
          .values({
            sessionId: input.sessionId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            usedAt: null,
            revokedAt: null
          })
          .returning()
          .execute()

        return yield* decodeNullableAuthLoginRefreshToken(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create auth login refresh token', error))),

  consumeActiveByTokenHash: (tokenHash: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const nowExpression = sql`now()`
        const rows = yield* db
          .update(authLoginRefreshTokens)
          .set({
            usedAt: nowExpression
          })
          .where(
            and(
              eq(authLoginRefreshTokens.tokenHash, tokenHash),
              isNull(authLoginRefreshTokens.usedAt),
              isNull(authLoginRefreshTokens.revokedAt),
              gt(authLoginRefreshTokens.expiresAt, nowExpression)
            )
          )
          .returning()
          .execute()

        return yield* decodeNullableAuthLoginRefreshToken(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to consume auth login refresh token', error))),

  findByTokenHash: (tokenHash: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(authLoginRefreshTokens)
          .where(eq(authLoginRefreshTokens.tokenHash, tokenHash))
          .limit(1)
          .execute()

        return yield* decodeNullableAuthLoginRefreshToken(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find auth login refresh token', error))),

  revokeActiveForSession: (sessionId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const nowExpression = sql`now()`
        const rows = yield* db
          .update(authLoginRefreshTokens)
          .set({
            revokedAt: nowExpression
          })
          .where(
            and(
              eq(authLoginRefreshTokens.sessionId, sessionId),
              isNull(authLoginRefreshTokens.usedAt),
              isNull(authLoginRefreshTokens.revokedAt),
              gt(authLoginRefreshTokens.expiresAt, nowExpression)
            )
          )
          .returning({ id: authLoginRefreshTokens.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to revoke auth login refresh tokens', error)))
}
