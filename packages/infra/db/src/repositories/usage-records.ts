import {
  and,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL
} from 'drizzle-orm'
import { type UsageCategory } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { usageRecordRowSchema } from '../effect-schemas/usage-records.js'
import { dbDecodeFailed } from '../errors.js'
import { usageRecords, type JsonObject } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { combinePredicates, createOptionalDecoder } from './sql-helpers.js'

const decodeUsageRecordRows = Schema.decodeUnknown(Schema.Array(usageRecordRowSchema))
const decode = createOptionalDecoder(usageRecordRowSchema, 'usage record')

const parseBigIntLikeNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

const buildListWhere = (input: {
  organizationId: string
  category?: UsageCategory
  recordedAfter?: Date
  recordedBefore?: Date
}): SQL => {
  const predicates: Array<SQL> = [eq(usageRecords.organizationId, input.organizationId)]

  if (input.category) {
    predicates.push(eq(usageRecords.category, input.category))
  }

  if (input.recordedAfter) {
    predicates.push(gte(usageRecords.recordedAt, input.recordedAfter))
  }

  if (input.recordedBefore) {
    predicates.push(lte(usageRecords.recordedAt, input.recordedBefore))
  }

  return combinePredicates(predicates)
}

const usageRecordSelectFields = {
  id: usageRecords.id,
  organizationId: usageRecords.organizationId,
  category: usageRecords.category,
  quantity: usageRecords.quantity,
  unitCostDecimillicents: usageRecords.unitCostDecimillicents,
  totalCostDecimillicents: usageRecords.totalCostDecimillicents,
  marginMultiplier: usageRecords.marginMultiplier,
  referenceId: usageRecords.referenceId,
  assetId: usageRecords.assetId,
  stripeUsageRecordId: usageRecords.stripeUsageRecordId,
  metadata: usageRecords.metadata,
  recordedAt: usageRecords.recordedAt,
  createdAt: usageRecords.createdAt
} as const

export const usageRecordsRepository = {
  record: (input: {
    organizationId: string
    category: UsageCategory
    quantity: number
    unitCostDecimillicents: number
    totalCostDecimillicents: number
    referenceId?: string | null
    stripeUsageRecordId?: string | null
    metadata?: JsonObject
    recordedAt?: Date
  }) =>
    withDb('Failed to record usage', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(usageRecords)
          .values({
            organizationId: input.organizationId,
            category: input.category,
            quantity: input.quantity,
            unitCostDecimillicents: input.unitCostDecimillicents,
            totalCostDecimillicents: input.totalCostDecimillicents,
            referenceId: input.referenceId ?? null,
            stripeUsageRecordId: input.stripeUsageRecordId ?? null,
            metadata: input.metadata ?? {},
            recordedAt: input.recordedAt ?? sql`now()`
          })
          .onConflictDoNothing({
            // Match the partial unique index in migration 0026 — conflict
            // resolution only applies when reference_id is non-null. The
            // `where` clause here mirrors the index predicate, otherwise
            // Postgres rejects the statement with 42P10
            // (infer_arbiter_indexes can't find a matching index).
            target: [usageRecords.organizationId, usageRecords.referenceId],
            where: sql`${usageRecords.referenceId} IS NOT NULL`
          })
          .returning()
          .execute()

        if (rows.length > 0) {
          return yield* decodeFirst(rows, decode)
        }

        if (input.referenceId) {
          const existingRows = yield* db
            .select(usageRecordSelectFields)
            .from(usageRecords)
            .where(and(
              eq(usageRecords.organizationId, input.organizationId),
              eq(usageRecords.referenceId, input.referenceId)
            ))
            .limit(1)
            .execute()

          return yield* decodeFirst(existingRows, decode)
        }

        return yield* decodeFirst(rows, decode)
      })
    ),

  updateStripeUsageRecordId: (id: string, stripeUsageRecordId: string) =>
    withDb('Failed to update usage record stripe id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        // financial-audit: exempt (stripe_usage_record_id is metadata backfill, not a financial mutation)
        const rows = yield* db
          .update(usageRecords)
          .set({ stripeUsageRecordId })
          .where(eq(usageRecords.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  findByReferenceId: (organizationId: string, referenceId: string) =>
    withDb('Failed to find usage record by reference id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(usageRecordSelectFields)
          .from(usageRecords)
          .where(and(
            eq(usageRecords.organizationId, organizationId),
            eq(usageRecords.referenceId, referenceId)
          ))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  listForOrganization: (input: {
    organizationId: string
    category?: UsageCategory
    recordedAfter?: Date
    recordedBefore?: Date
    limit?: number
  }) =>
    withDb('Failed to list usage records', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated (buildListWhere includes organizationId)
        const rows = yield* db
          .select(usageRecordSelectFields)
          .from(usageRecords)
          .where(buildListWhere(input))
          .orderBy(desc(usageRecords.recordedAt), desc(usageRecords.id))
          .limit(input.limit ?? 200)
          .execute()

        return yield* decodeUsageRecordRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('usage record list decode failed', error))
        )
      })
    ),

  summarizeForPeriod: (input: {
    organizationId: string
    category: UsageCategory
    periodStart: Date
    periodEnd: Date
  }) =>
    withDb('Failed to summarize usage records for period', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            totalQuantity: sql<number>`coalesce(sum(${usageRecords.quantity}), 0)`,
            totalCostDecimillicents: sql<number>`coalesce(sum(${usageRecords.totalCostDecimillicents}), 0)`
          })
          .from(usageRecords)
          .where(and(
            eq(usageRecords.organizationId, input.organizationId),
            eq(usageRecords.category, input.category),
            gte(usageRecords.recordedAt, input.periodStart),
            lte(usageRecords.recordedAt, input.periodEnd)
          ))
          .limit(1)
          .execute()

        const row = rows[0]
        return {
          totalQuantity: parseBigIntLikeNumber(row?.totalQuantity),
          totalCostDecimillicents: parseBigIntLikeNumber(row?.totalCostDecimillicents)
        }
      })
    )
}
