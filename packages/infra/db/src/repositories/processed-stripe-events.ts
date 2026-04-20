import { eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { processedStripeEventRowSchema } from '../effect-schemas/processed-stripe-events.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { processedStripeEvents } from '../schema.js'

const decodeProcessedStripeEventRow = Schema.decodeUnknown(processedStripeEventRowSchema)

export const processedStripeEventsRepository = {
  tryInsert: (eventId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(processedStripeEvents)
          .values({ eventId })
          .onConflictDoNothing({ target: processedStripeEvents.eventId })
          .returning()
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to insert processed stripe event', error))),

  findById: (eventId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(processedStripeEvents)
          .where(eq(processedStripeEvents.eventId, eventId))
          .limit(1)
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return yield* decodeProcessedStripeEventRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('processed stripe event row decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find processed stripe event', error))),

  /** Release a previously-claimed idempotency row so a retry can re-run
   *  the handler. Used when a webhook handler fails after `tryInsert` has
   *  already committed its claim — without this, the next Stripe retry
   *  would hit the existing row and silently short-circuit as
   *  `idempotent: true`, losing the state mutation that never happened.
   *
   *  @spec INV-BILLING-005 */
  deleteByEventId: (eventId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(processedStripeEvents)
          .where(eq(processedStripeEvents.eventId, eventId))
          .returning({ eventId: processedStripeEvents.eventId })
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to release processed stripe event claim', error)))
}
