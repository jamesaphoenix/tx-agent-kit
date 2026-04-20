import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { authLoginSessionRowSchema } from '../effect-schemas/auth-login-sessions.js'
import { authLoginAuditEvents, authLoginSessions } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(authLoginSessionRowSchema, 'auth login session row')

export const authLoginSessionsRepository = {
  create: (input: {
    userId: string
    provider: AuthLoginProvider
    createdIp: string | null
    createdUserAgent: string | null
    expiresAt: Date
  }) =>
    withDb('Failed to create auth login session', (db) =>
      Effect.gen(function* () {
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

        return yield* decodeFirst(rows, decode)
      })
    ),

  findActiveById: (id: string) =>
    withDb('Failed to find active auth login session', (db) =>
      Effect.gen(function* () {
        const nowExpression = sql`now()`
        const rows = yield* db
          .select({
            id: authLoginSessions.id,
            userId: authLoginSessions.userId,
            provider: authLoginSessions.provider,
            createdIp: authLoginSessions.createdIp,
            createdUserAgent: authLoginSessions.createdUserAgent,
            lastSeenAt: authLoginSessions.lastSeenAt,
            expiresAt: authLoginSessions.expiresAt,
            revokedAt: authLoginSessions.revokedAt,
            createdAt: authLoginSessions.createdAt
          })
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

        return yield* decodeFirst(rows, decode)
      })
    ),

  touchById: (id: string) =>
    withDb('Failed to touch auth login session', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(authLoginSessions)
          .set({
            lastSeenAt: sql`now()`
          })
          .where(
            and(
              eq(authLoginSessions.id, id),
              sql`${authLoginSessions.lastSeenAt} < now() - interval '60 seconds'`
            )
          )
          .returning({ id: authLoginSessions.id })
          .execute()

        return rows.length > 0
      })
    ),

  revokeById: (id: string) =>
    withDb('Failed to revoke auth login session', (db) =>
      Effect.gen(function* () {
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
    ),

  revokeAllForUser: (userId: string) =>
    withDb('Failed to revoke all auth login sessions for user', (db) =>
      Effect.gen(function* () {
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
    ),

  pruneExpired: (olderThan: Date) =>
    withDb('Failed to prune expired auth login sessions', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(authLoginSessions)
          .where(
            or(
              and(
                isNull(authLoginSessions.revokedAt),
                lt(authLoginSessions.expiresAt, olderThan)
              ),
              lt(authLoginSessions.revokedAt, olderThan)
            )
          )
          .returning({ id: authLoginSessions.id })
          .execute()

        return rows.length
      })
    ),

  pruneAuditEvents: (olderThan: Date) =>
    withDb('Failed to prune auth login audit events', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(authLoginAuditEvents)
          .where(lt(authLoginAuditEvents.createdAt, olderThan))
          .returning({ id: authLoginAuditEvents.id })
          .execute()

        return rows.length
      })
    )
}
