import { and, eq, gt, isNull, isNotNull, lt, or, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import {
  passwordResetTokenRowSchema,
} from '../effect-schemas/password-reset-tokens.js'
import { passwordResetTokens } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(passwordResetTokenRowSchema, 'password reset token row')

const decodeConsumed = createOptionalDecoder(
  Schema.Struct({ userId: Schema.UUID }),
  'consumed password reset token'
)

export const passwordResetTokensRepository = {
  create: (input: { userId: string; tokenHash: string }) =>
    withDb('Failed to create password reset token', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(passwordResetTokens)
          .values({
            userId: input.userId,
            tokenHash: input.tokenHash,
            usedAt: null
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  consumeByTokenHash: (tokenHash: string) =>
    withDb('Failed to consume password reset token', (db) =>
      Effect.gen(function* () {
        const nowExpression = sql`now()`

        const rows = yield* db
          .update(passwordResetTokens)
          .set({
            usedAt: nowExpression
          })
          .where(
            and(
              eq(passwordResetTokens.tokenHash, tokenHash),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expiresAt, nowExpression)
            )
          )
          .returning({
            userId: passwordResetTokens.userId
          })
          .execute()

        return yield* decodeFirst(rows, decodeConsumed)
      })
    ),

  revokeActiveForUser: (userId: string) =>
    withDb('Failed to revoke active password reset tokens', (db) =>
      Effect.gen(function* () {
        const nowExpression = sql`now()`

        const rows = yield* db
          .update(passwordResetTokens)
          .set({
            usedAt: nowExpression
          })
          .where(
            and(
              eq(passwordResetTokens.userId, userId),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expiresAt, nowExpression)
            )
          )
          .returning({
            id: passwordResetTokens.id
          })
          .execute()

        return rows.length
      })
    ),

  pruneExpired: (olderThan: Date) =>
    withDb('Failed to prune expired password reset tokens', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(passwordResetTokens)
          .where(
            or(
              and(
                isNotNull(passwordResetTokens.usedAt),
                lt(passwordResetTokens.createdAt, olderThan)
              ),
              lt(passwordResetTokens.expiresAt, olderThan)
            )
          )
          .returning({ id: passwordResetTokens.id })
          .execute()

        return rows.length
      })
    )
}
