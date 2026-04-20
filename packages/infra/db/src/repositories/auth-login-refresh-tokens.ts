import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { authLoginRefreshTokenRowSchema } from '../effect-schemas/auth-login-refresh-tokens.js'
import { authLoginRefreshTokens } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(authLoginRefreshTokenRowSchema, 'auth login refresh token row')

export const authLoginRefreshTokensRepository = {
  create: (input: { sessionId: string; tokenHash: string; expiresAt: Date }) =>
    withDb('Failed to create auth login refresh token', (db) =>
      Effect.gen(function* () {
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

        return yield* decodeFirst(rows, decode)
      })
    ),

  consumeActiveByTokenHash: (tokenHash: string) =>
    withDb('Failed to consume auth login refresh token', (db) =>
      Effect.gen(function* () {
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

        return yield* decodeFirst(rows, decode)
      })
    ),

  findByTokenHash: (tokenHash: string) =>
    withDb('Failed to find auth login refresh token', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(authLoginRefreshTokens)
          .where(eq(authLoginRefreshTokens.tokenHash, tokenHash))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  revokeActiveForSession: (sessionId: string) =>
    withDb('Failed to revoke auth login refresh tokens', (db) =>
      Effect.gen(function* () {
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
    ),

  revokeAllActiveForUser: (userId: string) =>
    withDb('Failed to revoke all auth login refresh tokens for user', (db) =>
      Effect.gen(function* () {
        const nowExpression = sql`now()`
        const rows = yield* db
          .update(authLoginRefreshTokens)
          .set({
            revokedAt: nowExpression
          })
          .where(
            and(
              inArray(
                authLoginRefreshTokens.sessionId,
                sql`(SELECT id FROM auth_login_sessions WHERE user_id = ${userId})`
              ),
              isNull(authLoginRefreshTokens.usedAt),
              isNull(authLoginRefreshTokens.revokedAt),
              gt(authLoginRefreshTokens.expiresAt, nowExpression)
            )
          )
          .returning({ id: authLoginRefreshTokens.id })
          .execute()

        return rows.length
      })
    ),

  pruneExpired: (olderThan: Date) =>
    withDb('Failed to prune expired auth login refresh tokens', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(authLoginRefreshTokens)
          .where(
            or(
              lt(authLoginRefreshTokens.expiresAt, olderThan),
              and(isNotNull(authLoginRefreshTokens.revokedAt), lt(authLoginRefreshTokens.revokedAt, olderThan)),
              and(isNotNull(authLoginRefreshTokens.usedAt), lt(authLoginRefreshTokens.usedAt, olderThan))
            )
          )
          .returning({ id: authLoginRefreshTokens.id })
          .execute()

        return rows.length
      })
    )
}
