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
import { DB, provideDB } from '../client.js'
import { usageRecordRowSchema, type UsageRecordRowShape } from '../effect-schemas/usage-records.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { usageRecords, type JsonObject } from '../schema.js'
import { combinePredicates } from './sql-helpers.js'

const decodeUsageRecordRows = Schema.decodeUnknown(Schema.Array(usageRecordRowSchema))
const decodeUsageRecordRow = Schema.decodeUnknown(usageRecordRowSchema)

const decodeNullableUsageRecord = (
  value: unknown
): Effect.Effect<UsageRecordRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeUsageRecordRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('usage record decode failed', error))
  )
}

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
}): SQL<unknown> => {
  const predicates: Array<SQL<unknown>> = [eq(usageRecords.organizationId, input.organizationId)]

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
  referenceId: usageRecords.referenceId,
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
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

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

          const existingRecord = yield* decodeNullableUsageRecord(existingRows[0] ?? null)
          if (existingRecord) {
            return existingRecord
          }
        }

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
            recordedAt: input.recordedAt ?? new Date()
          })
          .onConflictDoNothing({
            target: [usageRecords.organizationId, usageRecords.referenceId]
          })
          .returning()
          .execute()

        if (rows.length > 0) {
          return yield* decodeNullableUsageRecord(rows[0] ?? null)
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

          return yield* decodeNullableUsageRecord(existingRows[0] ?? null)
        }

        return yield* decodeNullableUsageRecord(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to record usage', error))),

  updateStripeUsageRecordId: (id: string, stripeUsageRecordId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(usageRecords)
          .set({ stripeUsageRecordId })
          .where(eq(usageRecords.id, id))
          .returning()
          .execute()

        return yield* decodeNullableUsageRecord(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update usage record stripe id', error))),

  findByReferenceId: (organizationId: string, referenceId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select(usageRecordSelectFields)
          .from(usageRecords)
          .where(and(
            eq(usageRecords.organizationId, organizationId),
            eq(usageRecords.referenceId, referenceId)
          ))
          .limit(1)
          .execute()

        return yield* decodeNullableUsageRecord(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find usage record by reference id', error))),

  listForOrganization: (input: {
    organizationId: string
    category?: UsageCategory
    recordedAfter?: Date
    recordedBefore?: Date
    limit?: number
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to list usage records', error))),

  summarizeForPeriod: (input: {
    organizationId: string
    category: UsageCategory
    periodStart: Date
    periodEnd: Date
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to summarize usage records for period', error)))
}
