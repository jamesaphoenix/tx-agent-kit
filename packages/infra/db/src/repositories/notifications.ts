import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { notificationRowSchema, type NotificationRowShape } from '../effect-schemas/notifications.js'
import { dbDecodeFailed } from '../errors.js'
import { notifications, type JsonObject } from '../schema.js'
import { withDb } from './repo-helpers.js'

const decodeRow = Schema.decodeUnknown(notificationRowSchema)
const decodeRows = Schema.decodeUnknown(Schema.Array(notificationRowSchema))

interface CreateNotificationInput {
  organizationId: string | null
  userId: string | null
  eventType: string
  title: string
  body: string
  metadata?: JsonObject
}

interface ListForUserInput {
  userId: string
  organizationId: string
  unreadOnly?: boolean
  limit?: number
  /** Cursor: `created_at < cursor`. Use the oldest row already seen. */
  cursor?: Date
}

export const notificationsRepository = {
  /**
   * Insert a single notification row.
   *
   * @spec INV-NOTIF-001 — in-app notifications are always created for
   * every event type regardless of email preference settings.
   */
  create: (input: CreateNotificationInput) =>
    withDb('Failed to create notification', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(notifications)
          .values({
            organizationId: input.organizationId,
            userId: input.userId,
            eventType: input.eventType,
            title: input.title,
            body: input.body,
            metadata: input.metadata ?? {}
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(new Error('notifications.create returned no row'))
        }
        return yield* decodeRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('notification row decode failed', error))
        )
      })
    ),

  /**
   * Insert a notification but collapse DB-level idempotency conflicts to
   * `null`. This is the race-safe companion to `findByOutboxEventId`: two
   * workers can both miss the preflight lookup, but the partial unique index
   * on `(user_id, organization_id, metadata->>'outbox_event_id')` still
   * guarantees only one insert wins.
   *
   * @spec INV-NOTIF-002 — outbox event idempotency under concurrent dispatch
   */
  createIdempotent: (input: CreateNotificationInput) =>
    withDb('Failed to create idempotent notification', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(notifications)
          .values({
            organizationId: input.organizationId,
            userId: input.userId,
            eventType: input.eventType,
            title: input.title,
            body: input.body,
            metadata: input.metadata ?? {}
          })
          .onConflictDoNothing()
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }
        return yield* decodeRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('notification row decode failed', error))
        )
      })
    ),

  /**
   * Indexed point lookup for an existing notification carrying the
   * same `metadata.outbox_event_id`. Used by the worker fan-out handler
   * to dedup retries of the same outbox event WITHOUT scanning the
   * caller's notification feed (the historical bounded page-scan
   * silently missed dedups for any user with more than 50 notifications,
   * violating INV-NOTIF-002).
   *
   * Backed by `notifications_outbox_event_id_user_org_uniq_idx` —
   * a partial UNIQUE index on (user_id, organization_id,
   * (metadata->>'outbox_event_id')) added in migration 0048.
   *
   * @spec INV-NOTIF-002 — outbox event idempotency
   */
  findByOutboxEventId: (input: {
    userId: string
    organizationId: string
    outboxEventId: string
  }) =>
    withDb('Failed to look up notification by outbox_event_id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(notifications)
          .where(and(
            eq(notifications.userId, input.userId),
            eq(notifications.organizationId, input.organizationId),
            sql`${notifications.metadata}->>'outbox_event_id' = ${input.outboxEventId}`
          ))
          .limit(1)
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }
        return yield* decodeRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('notification row decode failed', error))
        )
      })
    ),

  /**
   * Batch-insert multiple notifications in a single SQL round-trip. The
   * dispatch workflow (Phase 2) uses this to fan out one notification per
   * recipient without N separate inserts.
   */
  createBatch: (inputs: ReadonlyArray<CreateNotificationInput>) =>
    withDb('Failed to create notifications batch', (db) =>
      Effect.gen(function* () {
        if (inputs.length === 0) {
          return [] as ReadonlyArray<NotificationRowShape>
        }
        const rows = yield* db
          .insert(notifications)
          .values(
            inputs.map((input) => ({
              organizationId: input.organizationId,
              userId: input.userId,
              eventType: input.eventType,
              title: input.title,
              body: input.body,
              metadata: input.metadata ?? {}
            }))
          )
          .returning()
          .execute()
        return yield* decodeRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('notification rows decode failed', error))
        )
      })
    ),

  /**
   * List notifications for a user in a specific organization, newest first,
   * with cursor pagination. Enforces the org-scoped access invariant via
   * the composite WHERE — callers never see cross-org rows.
   *
   * @spec INV-NOTIF-006 — notifications are org-scoped.
   */
  listForUser: (input: ListForUserInput) =>
    withDb('Failed to list notifications for user', (db) =>
      Effect.gen(function* () {
        const predicates = [
          eq(notifications.userId, input.userId),
          eq(notifications.organizationId, input.organizationId)
        ]
        if (input.unreadOnly === true) {
          predicates.push(isNull(notifications.readAt))
        }
        if (input.cursor !== undefined) {
          predicates.push(lt(notifications.createdAt, input.cursor))
        }
        const rows = yield* db
          .select()
          .from(notifications)
          .where(and(...predicates))
          .orderBy(desc(notifications.createdAt))
          .limit(input.limit ?? 50)
          .execute()
        return yield* decodeRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('notification rows decode failed', error))
        )
      })
    ),

  /**
   * Mark a notification as read. Enforces that the caller owns the row
   * via the composite WHERE — silently returns null if the id is wrong or
   * the user is not the recipient.
   */
  markRead: (input: { id: string; userId: string }) =>
    withDb('Failed to mark notification read', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(notifications)
          .set({ readAt: sql`now()` })
          .where(and(
            eq(notifications.id, input.id),
            eq(notifications.userId, input.userId),
            isNull(notifications.readAt)
          ))
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }
        return yield* decodeRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('notification row decode failed', error))
        )
      })
    ),

  /**
   * Count unread notifications for a user in a specific org. Used by the
   * notification bell badge in the UI.
   */
  countUnread: (input: { userId: string; organizationId: string }) =>
    withDb('Failed to count unread notifications', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ total: count() })
          .from(notifications)
          .where(and(
            eq(notifications.userId, input.userId),
            eq(notifications.organizationId, input.organizationId),
            isNull(notifications.readAt)
          ))
          .execute()
        return rows[0]?.total ?? 0
      })
    )
}
