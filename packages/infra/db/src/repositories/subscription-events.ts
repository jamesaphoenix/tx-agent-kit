import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { subscriptionEventRowSchema } from '../effect-schemas/subscription-events.js'
import { subscriptionEvents, type JsonObject } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(subscriptionEventRowSchema, 'subscription event row')

export const subscriptionEventsRepository = {
  findByStripeEventId: (stripeEventId: string) =>
    withDb('Failed to find subscription event by stripe event id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: subscriptionEvents.id,
            stripeEventId: subscriptionEvents.stripeEventId,
            eventType: subscriptionEvents.eventType,
            organizationId: subscriptionEvents.organizationId,
            payload: subscriptionEvents.payload,
            processedAt: subscriptionEvents.processedAt,
            createdAt: subscriptionEvents.createdAt
          })
          .from(subscriptionEvents)
          .where(eq(subscriptionEvents.stripeEventId, stripeEventId))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  create: (input: {
    stripeEventId: string
    eventType: string
    organizationId?: string | null
    payload: JsonObject
  }) =>
    withDb('Failed to create subscription event', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(subscriptionEvents)
          .values({
            stripeEventId: input.stripeEventId,
            eventType: input.eventType,
            organizationId: input.organizationId ?? null,
            payload: input.payload
          })
          .onConflictDoNothing({
            target: subscriptionEvents.stripeEventId
          })
          .returning()
          .execute()

        if (rows.length > 0) {
          return yield* decodeFirst(rows, decode)
        }

        const existingRows = yield* db
          .select({
            id: subscriptionEvents.id,
            stripeEventId: subscriptionEvents.stripeEventId,
            eventType: subscriptionEvents.eventType,
            organizationId: subscriptionEvents.organizationId,
            payload: subscriptionEvents.payload,
            processedAt: subscriptionEvents.processedAt,
            createdAt: subscriptionEvents.createdAt
          })
          .from(subscriptionEvents)
          .where(eq(subscriptionEvents.stripeEventId, input.stripeEventId))
          .limit(1)
          .execute()

        return yield* decodeFirst(existingRows, decode)
      })
    ),

  markProcessed: (id: string) =>
    withDb('Failed to mark subscription event as processed', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(subscriptionEvents)
          .set({ processedAt: sql`now()` })
          .where(and(eq(subscriptionEvents.id, id), isNull(subscriptionEvents.processedAt)))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  pruneProcessed: (olderThan: Date) =>
    withDb('Failed to prune processed subscription events', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(subscriptionEvents)
          .where(
            and(
              isNotNull(subscriptionEvents.processedAt),
              lt(subscriptionEvents.processedAt, olderThan)
            )
          )
          .returning({ id: subscriptionEvents.id })
          .execute()

        return rows.length
      })
    )
}
