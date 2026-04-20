import { and, eq, gt, lte, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { monthlyCreditsUsageRowSchema, type MonthlyCreditsUsageRowShape } from '../effect-schemas/monthly-credits-usage.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { monthlyCreditsUsage } from '../schema.js'

const decodeMonthlyCreditsUsageRow = Schema.decodeUnknown(monthlyCreditsUsageRowSchema)

const decodeNullableMonthlyCreditsUsage = (
  value: unknown
): Effect.Effect<MonthlyCreditsUsageRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeMonthlyCreditsUsageRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('monthly credits usage row decode failed', error))
  )
}

export const monthlyCreditsUsageRepository = {
  getOrCreateForPeriod: (input: {
    orgId: string
    periodStart: Date
    periodEnd: Date
    planTier?: string | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const existing = yield* db
          .select()
          .from(monthlyCreditsUsage)
          .where(and(
            eq(monthlyCreditsUsage.orgId, input.orgId),
            eq(monthlyCreditsUsage.periodStart, input.periodStart)
          ))
          .limit(1)
          .execute()

        if (existing[0]) {
          return yield* decodeNullableMonthlyCreditsUsage(existing[0])
        }

        const rows = yield* db
          .insert(monthlyCreditsUsage)
          .values({
            orgId: input.orgId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            planTier: input.planTier ?? null,
            creditsUsed: 0
          })
          .onConflictDoNothing({
            target: [monthlyCreditsUsage.orgId, monthlyCreditsUsage.periodStart]
          })
          .returning()
          .execute()

        if (rows[0]) {
          return yield* decodeNullableMonthlyCreditsUsage(rows[0])
        }

        const retryRows = yield* db
          .select()
          .from(monthlyCreditsUsage)
          .where(and(
            eq(monthlyCreditsUsage.orgId, input.orgId),
            eq(monthlyCreditsUsage.periodStart, input.periodStart)
          ))
          .limit(1)
          .execute()

        return yield* decodeNullableMonthlyCreditsUsage(retryRows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get/create monthly credits usage', error))),

  // @spec INV-BILLING-008
  incrementCreditsUsed: (orgId: string, periodStart: Date, delta: number) =>
    provideDB(
      Effect.gen(function* () {
        if (delta < 0 || !Number.isInteger(delta)) {
          return yield* Effect.fail(new Error(`delta must be a non-negative integer, got ${delta}`))
        }
        const db = yield* DB
        const rows = yield* db
          .update(monthlyCreditsUsage)
          .set({
            creditsUsed: sql`${monthlyCreditsUsage.creditsUsed} + ${delta}`
          })
          .where(and(
            eq(monthlyCreditsUsage.orgId, orgId),
            eq(monthlyCreditsUsage.periodStart, periodStart)
          ))
          .returning({ creditsUsed: monthlyCreditsUsage.creditsUsed })
          .execute()

        return rows[0] ?? null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to increment monthly credits usage', error))),

  getCurrentPeriodUsage: (orgId: string, now: Date) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(monthlyCreditsUsage)
          .where(and(
            eq(monthlyCreditsUsage.orgId, orgId),
            lte(monthlyCreditsUsage.periodStart, now),
            gt(monthlyCreditsUsage.periodEnd, now)
          ))
          .limit(1)
          .execute()

        return yield* decodeNullableMonthlyCreditsUsage(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get current period usage', error)))
}
