import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  authLoginSessionRowSchema,
  type AuthLoginSessionRowShape
} from '../effect-schemas/auth-login-sessions.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { authLoginSessions } from '../schema.js'

const decodeAuthLoginSessionRow = Schema.decodeUnknown(authLoginSessionRowSchema)

const decodeNullableAuthLoginSession = (
  value: unknown
): Effect.Effect<AuthLoginSessionRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeAuthLoginSessionRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('auth login session row decode failed', error))
  )
}

export const authLoginSessionsRepository = {
  create: (input: {
    userId: string
    provider: AuthLoginProvider
    createdIp: string | null
    createdUserAgent: string | null
    expiresAt: Date
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(authLoginSessions)
          .values({
            userId: input.userId,
            provider: input.provider,
            createdIp: input.createdIp,
            createdUserAgent: input.createdUserAgent,
            lastSeenAt: sql`now()`,
            expiresAt: input.expiresAt,
            revokedAt: null
          })
          .returning()
          .execute()

        return yield* decodeNullableAuthLoginSession(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create auth login session', error))),

  findActiveById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const nowExpression = sql`now()`
        const rows = yield* db
          .select()
          .from(authLoginSessions)
          .where(
            and(
              eq(authLoginSessions.id, id),
              isNull(authLoginSessions.revokedAt),
              gt(authLoginSessions.expiresAt, nowExpression)
            )
          )
          .limit(1)
          .execute()

        return yield* decodeNullableAuthLoginSession(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find active auth login session', error))),

  touchById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(authLoginSessions)
          .set({
            lastSeenAt: sql`now()`
          })
          .where(eq(authLoginSessions.id, id))
          .returning({ id: authLoginSessions.id })
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to touch auth login session', error))),

  revokeById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(authLoginSessions)
          .set({
            revokedAt: sql`now()`
          })
          .where(and(eq(authLoginSessions.id, id), isNull(authLoginSessions.revokedAt)))
          .returning({ id: authLoginSessions.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to revoke auth login session', error))),

  revokeAllForUser: (userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(authLoginSessions)
          .set({
            revokedAt: sql`now()`
          })
          .where(and(eq(authLoginSessions.userId, userId), isNull(authLoginSessions.revokedAt)))
          .returning({ id: authLoginSessions.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to revoke all auth login sessions for user', error)))
}
