import { and, eq, sql } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { dbDecodeFailed } from '../errors.js'
import { monthlyCreditsUsageRowSchema } from '../effect-schemas/monthly-credits-usage.js'
import { monthlyCreditsUsage, organizations } from '../schema.js'
import { withDb } from './repo-helpers.js'
import { insertDomainEventInTransaction } from './domain-events.js'

// Decoder for the (usageCap, creditsUsed) projection returned by getOrgCapState.
// Re-uses monthlyCreditsUsageRowSchema's numeric shape for creditsUsed so that
// rows with bigint PG types are normalized the same way as the rest of the
// monthly_credits_usage code path.
const usageCapProjectionSchema = Schema.Struct({
  usageCap: Schema.NullOr(monthlyCreditsUsageRowSchema.fields.creditsUsed),
  creditsUsed: Schema.NullOr(monthlyCreditsUsageRowSchema.fields.creditsUsed)
})
const decodeUsageCapProjection = Schema.decodeUnknown(usageCapProjectionSchema)

/**
 * Repository for two-level usage cap enforcement. Reads the org-level
 * `usage_cap` value alongside the current period's `credits_used` counter,
 * and provides a single-statement atomic increment for INV-BILLING-008.
 */
export const usageCapRepository = {
  /**
   * Atomically read organizations.usage_cap joined with the current period's
   * monthly_credits_usage.credits_used. If no monthly_credits_usage row
   * exists yet for the period, creditsUsed defaults to 0 via LEFT JOIN.
   */
  getOrgCapState: (input: {
    orgId: string
    periodStart: Date
    periodEnd: Date
  }) =>
    withDb('Failed to read org usage cap state', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            usageCap: organizations.usageCap,
            creditsUsed: monthlyCreditsUsage.creditsUsed
          })
          .from(organizations)
          .leftJoin(
            monthlyCreditsUsage,
            and(
              eq(monthlyCreditsUsage.orgId, organizations.id),
              eq(monthlyCreditsUsage.periodStart, input.periodStart)
            )
          )
          .where(eq(organizations.id, input.orgId))
          .limit(1)
          .execute()

        const first = rows[0]
        if (!first) {
          return Option.none<{ usageCap: Option.Option<number>; creditsUsed: number }>()
        }

        const decoded = yield* decodeUsageCapProjection(first).pipe(
          Effect.mapError((error) => dbDecodeFailed('usage cap projection decode failed', error))
        )

        return Option.some({
          usageCap: Option.fromNullable(decoded.usageCap),
          creditsUsed: decoded.creditsUsed ?? 0
        })
      })
    ),

  /**
   * Atomic single-statement increment of credits_used for the given period.
   * Uses INSERT ... ON CONFLICT (org_id, period_start) DO UPDATE so that two
   * concurrent workers can never lose an update.
   *
   * @spec INV-BILLING-008
   */
  incrementMonthlyUsage: (input: {
    orgId: string
    periodStart: Date
    periodEnd: Date
    deltaDecimillicents: number
    planTier: string | null
  }) =>
    withDb('Failed to increment monthly usage', (db) =>
      Effect.gen(function* () {
        if (!Number.isInteger(input.deltaDecimillicents) || input.deltaDecimillicents < 0) {
          return yield* Effect.fail(
            new Error(
              `deltaDecimillicents must be a non-negative integer, got ${input.deltaDecimillicents}`
            )
          )
        }

        yield* db
          .insert(monthlyCreditsUsage)
          .values({
            orgId: input.orgId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            creditsUsed: input.deltaDecimillicents,
            planTier: input.planTier
          })
          .onConflictDoUpdate({
            target: [monthlyCreditsUsage.orgId, monthlyCreditsUsage.periodStart],
            set: {
              creditsUsed: sql`${monthlyCreditsUsage.creditsUsed} + ${input.deltaDecimillicents}`
            }
          })
          .execute()
      })
    ),

  /**
   * Atomic increment + threshold-crossing outbox emission.
   *
   * Locks the (org_id, period_start) row together with organizations.usage_cap,
   * computes the new credits_used, classifies the crossing against 80 / 95 /
   * 100 % thresholds, and writes `billing.usage_cap_warning` or
   * `billing.usage_cap_exceeded` events into domain_events in the SAME
   * transaction as the UPDATE that caused the crossing.
   *
   * Only "first-time" crossings emit an event — if the previous credits_used
   * was already at or above the threshold, no event fires.
   *
   * @spec INV-BILLING-008 — lost-update safe via SELECT FOR UPDATE
   * @spec INV-BILLING-009 — event commit is transactional with the mutation
   */
  incrementMonthlyUsageAndEmit: (input: {
    orgId: string
    periodStart: Date
    periodEnd: Date
    deltaDecimillicents: number
    planTier: string | null
  }) =>
    withDb('Failed to increment monthly usage with outbox', (db) =>
      Effect.gen(function* () {
        if (!Number.isInteger(input.deltaDecimillicents) || input.deltaDecimillicents < 0) {
          return yield* Effect.fail(
            new Error(
              `deltaDecimillicents must be a non-negative integer, got ${input.deltaDecimillicents}`
            )
          )
        }

        return yield* db.transaction((trx) =>
          Effect.gen(function* () {
            // tenant-scope: service-validated (orgId passed through by caller)
            const orgRows = yield* trx
              .select({ usageCap: organizations.usageCap })
              .from(organizations)
              .where(eq(organizations.id, input.orgId))
              .for('update')
              .execute()

            const orgRow = orgRows[0]
            if (!orgRow) {
              return yield* Effect.fail(new Error(`Organization ${input.orgId} not found`))
            }

            // tenant-scope: service-validated (orgId + periodStart)
            const existingRows = yield* trx
              .select({ creditsUsed: monthlyCreditsUsage.creditsUsed })
              .from(monthlyCreditsUsage)
              .where(
                and(
                  eq(monthlyCreditsUsage.orgId, input.orgId),
                  eq(monthlyCreditsUsage.periodStart, input.periodStart)
                )
              )
              .for('update')
              .execute()

            const previousCreditsUsed = existingRows[0]?.creditsUsed ?? 0
            const newCreditsUsed = previousCreditsUsed + input.deltaDecimillicents

            yield* trx
              .insert(monthlyCreditsUsage)
              .values({
                orgId: input.orgId,
                periodStart: input.periodStart,
                periodEnd: input.periodEnd,
                creditsUsed: input.deltaDecimillicents,
                planTier: input.planTier
              })
              .onConflictDoUpdate({
                target: [monthlyCreditsUsage.orgId, monthlyCreditsUsage.periodStart],
                set: {
                  creditsUsed: sql`${monthlyCreditsUsage.creditsUsed} + ${input.deltaDecimillicents}`
                }
              })
              .execute()

            const cap = orgRow.usageCap
            if (cap === null || cap <= 0) {
              return {
                previousCreditsUsed,
                newCreditsUsed,
                capDecimillicents: null as number | null,
                emittedEventType: null as null | 'billing.usage_cap_warning' | 'billing.usage_cap_exceeded'
              }
            }

            const previousPercent = (previousCreditsUsed / cap) * 100
            const newPercent = (newCreditsUsed / cap) * 100

            const crossedExceeded = previousPercent < 100 && newPercent >= 100
            const crossed95 = previousPercent < 95 && newPercent >= 95
            const crossed80 = previousPercent < 80 && newPercent >= 80

            let emittedEventType:
              | null
              | 'billing.usage_cap_warning'
              | 'billing.usage_cap_exceeded' = null

            if (crossedExceeded) {
              yield* insertDomainEventInTransaction(trx, {
                eventType: 'billing.usage_cap_exceeded',
                aggregateType: 'billing',
                aggregateId: input.orgId,
                payload: {
                  organizationId: input.orgId,
                  capDecimillicents: cap
                },
                correlationId: null
              })
              emittedEventType = 'billing.usage_cap_exceeded'
            } else if (crossed95) {
              yield* insertDomainEventInTransaction(trx, {
                eventType: 'billing.usage_cap_warning',
                aggregateType: 'billing',
                aggregateId: input.orgId,
                payload: {
                  organizationId: input.orgId,
                  percentUsed: Math.floor(newPercent),
                  capDecimillicents: cap
                },
                correlationId: null
              })
              emittedEventType = 'billing.usage_cap_warning'
            } else if (crossed80) {
              yield* insertDomainEventInTransaction(trx, {
                eventType: 'billing.usage_cap_warning',
                aggregateType: 'billing',
                aggregateId: input.orgId,
                payload: {
                  organizationId: input.orgId,
                  percentUsed: Math.floor(newPercent),
                  capDecimillicents: cap
                },
                correlationId: null
              })
              emittedEventType = 'billing.usage_cap_warning'
            }

            return {
              previousCreditsUsed,
              newCreditsUsed,
              capDecimillicents: cap,
              emittedEventType
            }
          })
        )
      })
    ),

  /**
   * Emit a standalone `billing.usage_cap_exceeded` event without mutating
   * monthly_credits_usage. Used by the rejection path of `checkUsageCaps`
   * when a reservation would push the org over 100 % of its cap — the debit
   * is refused, but downstream consumers still need to know the org tripped
   * the cap ceiling.
   *
   * @spec INV-BILLING-009 — inserts the event in its own transaction so the
   * rejection is observable even though no ledger row was written.
   */
  emitUsageCapExceeded: (input: {
    orgId: string
    capDecimillicents: number
  }) =>
    withDb('Failed to emit usage_cap_exceeded event', (db) =>
      db.transaction((trx) =>
        Effect.gen(function* () {
          yield* insertDomainEventInTransaction(trx, {
            eventType: 'billing.usage_cap_exceeded',
            aggregateType: 'billing',
            aggregateId: input.orgId,
            payload: {
              organizationId: input.orgId,
              capDecimillicents: input.capDecimillicents
            },
            correlationId: null
          })
        })
      )
    )
}
