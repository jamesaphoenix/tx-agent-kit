import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { autoRechargeAttemptRowSchema } from '../effect-schemas/auto-recharge-attempts.js'
import { dbDecodeFailed } from '../errors.js'
import { autoRechargeAttempts, domainEvents } from '../schema.js'
import { insertDomainEventInTransaction } from './domain-events.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createNullableDecoder, createOptionalDecoder } from './sql-helpers.js'

const decodeAutoRechargeAttemptRows = Schema.decodeUnknown(Schema.Array(autoRechargeAttemptRowSchema))
const decodeAutoRechargeAttempt = createOptionalDecoder(autoRechargeAttemptRowSchema, 'auto recharge attempt row')
const autoRechargeRequiresActionChallengeSchema = Schema.Struct({
  attemptId: Schema.UUID,
  amountDecimillicents: Schema.Number,
  stripePaymentIntentId: Schema.String,
  clientSecret: Schema.String
})
const decodeAutoRechargeRequiresActionChallenge = createNullableDecoder(
  autoRechargeRequiresActionChallengeSchema,
  'auto recharge requires_action challenge'
)

export const autoRechargeAttemptsRepository = {
  /**
   * Insert a pending auto-recharge attempt for an organization, collapsing
   * concurrent inserts to a single row via the partial unique index
   * `auto_recharge_attempts_one_pending_per_org_uniq_idx`.
   *
   * Called by the billing outbox consumer when handling a
   * `billing.credits_low_balance` event. Under parallel invocation the
   * winning INSERT commits and losers fall through `ON CONFLICT DO NOTHING`
   * with no row returned; the caller should then re-read the pending row
   * via {@link findLatestPendingForOrganization} and reuse its attempt id.
   *
   * Idempotency: callers still check for an existing pending row BEFORE
   * calling this to avoid the insert entirely on the happy path; this
   * method is the DB-level safety net for the check-then-insert race.
   *
   * @spec INV-BILLING-010 — billing consumers must be idempotent.
   */
  createPending: (input: {
    organizationId: string
    amountDecimillicents: number
  }) =>
    withDb('Failed to insert pending auto recharge attempt', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(autoRechargeAttempts)
          .values({
            organizationId: input.organizationId,
            amountDecimillicents: input.amountDecimillicents,
            status: 'pending'
          })
          .onConflictDoNothing({
            target: autoRechargeAttempts.organizationId,
            where: sql`${autoRechargeAttempts.status} = 'pending'`
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeAutoRechargeAttempt)
      })
    ),

  /**
   * Find the most recent pending auto-recharge attempt for an organization,
   * if any. Used by the outbox consumer to short-circuit when an attempt is
   * already in flight, providing idempotency for retries of the same
   * `billing.credits_low_balance` event.
   */
  findLatestPendingForOrganization: (organizationId: string) =>
    withDb('Failed to find pending auto recharge attempt', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(autoRechargeAttempts)
          .where(and(
            eq(autoRechargeAttempts.organizationId, organizationId),
            eq(autoRechargeAttempts.status, 'pending')
          ))
          .execute()

        return yield* decodeAutoRechargeAttemptRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('auto recharge attempt list decode failed', error))
        )
      })
    ),

  findById: (attemptId: string) =>
    withDb('Failed to find auto recharge attempt', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(autoRechargeAttempts)
          .where(eq(autoRechargeAttempts.id, attemptId))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeAutoRechargeAttempt)
      })
    ),

  findLatestRequiresActionChallenge: (organizationId: string) =>
    withDb('Failed to find latest auto recharge requires_action challenge', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            attemptId: autoRechargeAttempts.id,
            amountDecimillicents: autoRechargeAttempts.amountDecimillicents,
            stripePaymentIntentId: autoRechargeAttempts.stripePaymentIntentId,
            clientSecret: sql<string>`${domainEvents.payload} ->> 'clientSecret'`
          })
          .from(domainEvents)
          .innerJoin(
            autoRechargeAttempts,
            sql`${autoRechargeAttempts.id}::text = ${domainEvents.payload} ->> 'attemptId'`
          )
          .where(and(
            eq(domainEvents.eventType, 'billing.recharge_requires_action'),
            eq(domainEvents.aggregateType, 'billing'),
            eq(domainEvents.aggregateId, organizationId),
            eq(autoRechargeAttempts.organizationId, organizationId),
            eq(autoRechargeAttempts.status, 'failed'),
            eq(autoRechargeAttempts.failureReason, 'requires user action'),
            isNotNull(autoRechargeAttempts.stripePaymentIntentId),
            sql`${domainEvents.payload} ->> 'clientSecret' IS NOT NULL`
          ))
          .orderBy(
            desc(domainEvents.occurredAt),
            desc(domainEvents.sequenceNumber),
            desc(domainEvents.id)
          )
          .limit(1)
          .execute()

        return yield* decodeAutoRechargeRequiresActionChallenge(rows[0] ?? null)
      })
    ),

  /**
   * Mark a pending auto-recharge attempt as `succeeded` after Stripe confirms
   * the off-session PaymentIntent. Records the Stripe PaymentIntent id and
   * stamps `completed_at`.
   *
   * @spec billing-and-pricing-design
   */
  markSucceeded: (attemptId: string, stripePaymentIntentId: string) =>
    withDb('Failed to mark auto recharge attempt as succeeded', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(autoRechargeAttempts)
          .set({
            status: 'succeeded',
            failureReason: null,
            stripePaymentIntentId,
            completedAt: new Date()
          })
          .where(eq(autoRechargeAttempts.id, attemptId))
          .execute()
      })
    ),

  /**
   * Mark a pending auto-recharge attempt as `failed` with a human-readable
   * reason. Optionally records the Stripe PaymentIntent id when Stripe
   * produced one (e.g. requires_action, requires_payment_method).
   *
   * @spec billing-and-pricing-design
   */
  markFailed: (
    attemptId: string,
    reason: string,
    stripePaymentIntentId: string | null = null
  ) =>
    withDb('Failed to mark auto recharge attempt as failed', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(autoRechargeAttempts)
          .set({
            status: 'failed',
            failureReason: reason,
            stripePaymentIntentId,
            completedAt: new Date()
          })
          .where(eq(autoRechargeAttempts.id, attemptId))
          .execute()
      })
    ),

  /**
   * Atomically mark a pending attempt as `failed` (reason "requires user
   * action") AND insert a `billing.recharge_requires_action` outbox event
   * carrying the PaymentIntent client_secret. The two writes share a
   * single DB transaction so a downstream consumer (frontend
   * notification surface) never observes one without the other.
   *
   * Idempotent on second call: the conditional UPDATE's WHERE clause
   * skips rows that are already in a terminal state, and the outbox
   * event INSERT is only attempted when the UPDATE actually mutated a
   * row.
   *
   * @spec billing-and-pricing-design §"3DS off-session challenge"
   * @spec INV-BILLING-009 — atomic ledger commit pattern.
   * @spec INV-BILLING-010 — billing consumers are idempotent.
   */
  markRequiresActionAndEmit: (input: {
    attemptId: string
    organizationId: string
    amountDecimillicents: number
    stripePaymentIntentId: string
    clientSecret: string
  }) =>
    withDb('Failed to mark auto recharge attempt as requires_action', (db) =>
      db.transaction((trx) =>
        Effect.gen(function* () {
          const updated = yield* trx
            .update(autoRechargeAttempts)
            .set({
              status: 'failed',
              failureReason: 'requires user action',
              stripePaymentIntentId: input.stripePaymentIntentId,
              completedAt: new Date()
            })
            .where(and(
              eq(autoRechargeAttempts.id, input.attemptId),
              eq(autoRechargeAttempts.status, 'pending')
            ))
            .returning({ id: autoRechargeAttempts.id })
            .execute()

          if (updated.length === 0) {
            // Already terminal — skip the outbox emission so a retry of
            // the activity is a no-op.
            return
          }

          yield* insertDomainEventInTransaction(trx, {
            eventType: 'billing.recharge_requires_action',
            aggregateType: 'billing',
            aggregateId: input.organizationId,
            payload: {
              organizationId: input.organizationId,
              attemptId: input.attemptId,
              amountDecimillicents: input.amountDecimillicents,
              stripePaymentIntentId: input.stripePaymentIntentId,
              clientSecret: input.clientSecret
            }
          })
        })
      )
    ),

  /**
   * Mark a failed attempt as eligible for one retry at `nextRetryAt`.
   * Idempotent on second call against an already-scheduled row — the
   * timestamp stays whatever was first written so the 48 h clock starts
   * from the original failure instant, not the retry-scheduling moment.
   *
   * @spec billing-and-pricing-design §"Auto-recharge retry policy"
   */
  scheduleRetry: (attemptId: string, nextRetryAt: Date) =>
    withDb('Failed to schedule auto recharge attempt retry', (db) =>
      Effect.gen(function* () {
        const result = yield* db
          .update(autoRechargeAttempts)
          .set({ nextRetryAt })
          .where(and(
            eq(autoRechargeAttempts.id, attemptId),
            // Only schedule a retry on a still-failed row that doesn't
            // already have a retry queued. Conditional update preserves
            // the original retry instant on idempotent retries.
            eq(autoRechargeAttempts.status, 'failed'),
            sql`${autoRechargeAttempts.nextRetryAt} IS NULL`,
            sql`${autoRechargeAttempts.retriedFromAttemptId} IS NULL`
          ))
          .returning({ id: autoRechargeAttempts.id })
          .execute()

        return { scheduled: result.length > 0 }
      })
    ),

  /**
   * Find every failed attempt whose `next_retry_at` has elapsed and which
   * has not yet been retried. Driven by the hourly
   * `autoRechargeRetryWorkflow` schedule. The query is restricted by the
   * partial index on `next_retry_at`.
   *
   * @spec billing-and-pricing-design §"Auto-recharge retry policy"
   */
  findDueRetries: (now: Date) =>
    withDb('Failed to scan for due auto recharge retries', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(autoRechargeAttempts)
          .where(and(
            isNotNull(autoRechargeAttempts.nextRetryAt),
            lte(autoRechargeAttempts.nextRetryAt, now),
            eq(autoRechargeAttempts.status, 'failed')
          ))
          .execute()

        return yield* decodeAutoRechargeAttemptRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('due retries decode failed', error))
        )
      })
    ),

  /**
   * Insert a new pending attempt that records its retry-from pointer back
   * to the original failed attempt. The retry scheduler atomically clears
   * the original row's `next_retry_at` so the same retry is never scanned
   * twice.
   *
   * @spec billing-and-pricing-design §"Auto-recharge retry policy"
   */
  createRetryAttempt: (input: {
    organizationId: string
    amountDecimillicents: number
    retriedFromAttemptId: string
  }) =>
    withDb('Failed to create retry auto recharge attempt', (db) =>
      Effect.gen(function* () {
        // Atomically clear the original row's nextRetryAt so concurrent
        // scheduler runs collapse to a single retry.
        const updated = yield* db
          .update(autoRechargeAttempts)
          .set({ nextRetryAt: null })
          .where(and(
            eq(autoRechargeAttempts.id, input.retriedFromAttemptId),
            isNotNull(autoRechargeAttempts.nextRetryAt)
          ))
          .returning({ id: autoRechargeAttempts.id })
          .execute()

        // If nothing was cleared another worker already claimed this
        // retry — return null so the caller skips it.
        if (updated.length === 0) {
          return null
        }

        // Race: a concurrent `credits_low_balance` event may have
        // already fired `createPending` for the same org between our
        // UPDATE above and this INSERT. After migration 0043 the
        // partial unique index `(organization_id) WHERE status =
        // 'pending'` rejects the second insert with a unique_violation.
        // Use ON CONFLICT DO NOTHING + a re-read so the scheduler
        // gracefully yields to the concurrent pending attempt (which
        // will get charged on its own cycle) instead of crashing.
        const inserted = yield* db
          .insert(autoRechargeAttempts)
          .values({
            organizationId: input.organizationId,
            amountDecimillicents: input.amountDecimillicents,
            status: 'pending',
            retriedFromAttemptId: input.retriedFromAttemptId
          })
          .onConflictDoNothing({
            target: autoRechargeAttempts.organizationId,
            where: sql`${autoRechargeAttempts.status} = 'pending'`
          })
          .returning()
          .execute()

        if (inserted.length === 0) {
          // Another pending row already exists for this org. The retry
          // we intended to fire has effectively collapsed into the
          // concurrent pending attempt — safe to drop on the floor.
          return null
        }

        return yield* decodeFirst(inserted, decodeAutoRechargeAttempt)
      })
    ),

  /**
   * Mark a failed attempt as `permanent_failed` once its retry has also
   * failed. Stops the retry loop — operators expect the org to top up
   * manually or update the saved payment method via the customer portal.
   *
   * @spec billing-and-pricing-design §"Auto-recharge retry policy"
   */
  markPermanentFailed: (attemptId: string, reason: string) =>
    withDb('Failed to mark auto recharge attempt as permanent_failed', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(autoRechargeAttempts)
          .set({
            status: 'permanent_failed',
            failureReason: reason,
            nextRetryAt: null,
            completedAt: new Date()
          })
          .where(eq(autoRechargeAttempts.id, attemptId))
          .execute()
      })
    )
}
