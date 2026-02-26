import { eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  subscriptionEventRowSchema,
  type SubscriptionEventRowShape
} from '../effect-schemas/subscription-events.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { subscriptionEvents, type JsonObject } from '../schema.js'

const decodeSubscriptionEventRow = Schema.decodeUnknown(subscriptionEventRowSchema)

const decodeNullableSubscriptionEvent = (
  value: unknown
): Effect.Effect<SubscriptionEventRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeSubscriptionEventRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('subscription event row decode failed', error))
  )
}

export const subscriptionEventsRepository = {
  findByStripeEventId: (stripeEventId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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

        return yield* decodeNullableSubscriptionEvent(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find subscription event by stripe event id', error))),

  create: (input: {
    stripeEventId: string
    eventType: string
    organizationId?: string | null
    payload: JsonObject
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
          return yield* decodeNullableSubscriptionEvent(rows[0] ?? null)
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

        return yield* decodeNullableSubscriptionEvent(existingRows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create subscription event', error))),

  markProcessed: (id: string, processedAt: Date = new Date()) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(subscriptionEvents)
          .set({ processedAt })
          .where(eq(subscriptionEvents.id, id))
          .returning()
          .execute()

        return yield* decodeNullableSubscriptionEvent(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to mark subscription event as processed', error)))
}
