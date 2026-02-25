import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  passwordResetTokenRowSchema,
  type PasswordResetTokenRowShape
} from '../effect-schemas/password-reset-tokens.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { passwordResetTokens } from '../schema.js'

const decodePasswordResetTokenRow = Schema.decodeUnknown(passwordResetTokenRowSchema)
const decodeConsumedResetTokenRow = Schema.decodeUnknown(
  Schema.Struct({
    userId: Schema.UUID
  })
)

const decodeNullablePasswordResetToken = (
  value: unknown
): Effect.Effect<PasswordResetTokenRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodePasswordResetTokenRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('password reset token row decode failed', error))
  )
}

const decodeNullableConsumedResetToken = (
  value: unknown
): Effect.Effect<{ userId: string } | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeConsumedResetTokenRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('consumed password reset token decode failed', error))
  )
}

export const passwordResetTokensRepository = {
  create: (input: { userId: string; tokenHash: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(passwordResetTokens)
          .values({
            userId: input.userId,
            tokenHash: input.tokenHash,
            usedAt: null
          })
          .returning()
          .execute()

        return yield* decodeNullablePasswordResetToken(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create password reset token', error))),

  consumeByTokenHash: (tokenHash: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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

        return yield* decodeNullableConsumedResetToken(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to consume password reset token', error))),

  revokeActiveForUser: (userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to revoke active password reset tokens', error)))
}
