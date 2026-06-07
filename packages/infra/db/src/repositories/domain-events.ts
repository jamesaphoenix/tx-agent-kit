import { and, eq, inArray, lte, or, sql } from 'drizzle-orm'
import type { DomainEventType, DomainEventAggregateType } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { type DbClient } from '../client.js'
import { domainEventRowSchema, type DomainEventRowShape } from '../effect-schemas/domain-events.js'
import { dbDecodeFailed } from '../errors.js'
import { domainEvents, type JsonObject } from '../schema.js'
import { withDb } from './repo-helpers.js'

const decodeDomainEventRows = Schema.decodeUnknown(Schema.Array(domainEventRowSchema))
const decodeDomainEventRow = Schema.decodeUnknown(domainEventRowSchema)

interface RawDomainEventRowShape {
  readonly [key: string]: unknown
  readonly id: DomainEventRowShape['id']
  readonly eventType: DomainEventRowShape['eventType']
  readonly aggregateType: DomainEventRowShape['aggregateType']
  readonly aggregateId: DomainEventRowShape['aggregateId']
  readonly payload: DomainEventRowShape['payload']
  readonly correlationId: DomainEventRowShape['correlationId']
  readonly sequenceNumber: DomainEventRowShape['sequenceNumber']
  readonly status: DomainEventRowShape['status']
  readonly occurredAt: unknown
  readonly processingAt: unknown
  readonly publishedAt: unknown
  readonly failedAt: unknown
  readonly failureReason: DomainEventRowShape['failureReason']
  readonly createdAt: unknown
}

const normalizeTimestamp = (value: unknown): unknown => {
  if (value === null || value instanceof Date) {
    return value
  }

  if (typeof value !== 'string') {
    return value
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed
}

const normalizeRawDomainEventRow = (row: RawDomainEventRowShape) => ({
  ...row,
  occurredAt: normalizeTimestamp(row.occurredAt),
  processingAt: normalizeTimestamp(row.processingAt),
  publishedAt: normalizeTimestamp(row.publishedAt),
  failedAt: normalizeTimestamp(row.failedAt),
  createdAt: normalizeTimestamp(row.createdAt)
})

export interface DomainEventInput {
  eventType: DomainEventType
  aggregateType: DomainEventAggregateType
  aggregateId: string
  payload: JsonObject
  correlationId?: string | null
  sequenceNumber?: number
}

export interface InsertDomainEventInput {
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: JsonObject
  correlationId?: string | null
}

export const insertDomainEventInTransaction = (
  trx: Pick<DbClient, 'insert'>,
  input: InsertDomainEventInput
) =>
  trx
    .insert(domainEvents)
    .values({
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
      sequenceNumber: sql`(SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM domain_events WHERE aggregate_id = ${input.aggregateId})`
    })
    .execute()

export const domainEventsRepository = {
  create: (input: DomainEventInput) =>
    withDb('Failed to create domain event', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(domainEvents)
          .values({
            eventType: input.eventType,
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            payload: input.payload,
            correlationId: input.correlationId ?? null,
            sequenceNumber:
              input.sequenceNumber ??
              sql`(SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM domain_events WHERE aggregate_id = ${input.aggregateId})`
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            dbDecodeFailed('Domain event insert returned no row', new Error('empty returning'))
          )
        }

        return yield* decodeDomainEventRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('domain event row decode failed', error))
        )
      })
    ),

  fetchUnprocessed: (limit: number) =>
    withDb('Failed to fetch unprocessed domain events', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.execute<RawDomainEventRowShape>(sql`
          WITH events_to_claim AS MATERIALIZED (
            SELECT id
              FROM domain_events
             WHERE status = 'pending'
             ORDER BY occurred_at ASC, id ASC
             LIMIT ${limit}
             FOR UPDATE SKIP LOCKED
          )
          UPDATE domain_events
             SET status = 'processing',
                 processing_at = now()
            FROM events_to_claim
           WHERE domain_events.id = events_to_claim.id
           RETURNING domain_events.id,
                     domain_events.event_type AS "eventType",
                     domain_events.aggregate_type AS "aggregateType",
                     domain_events.aggregate_id AS "aggregateId",
                     domain_events.payload,
                     domain_events.correlation_id AS "correlationId",
                     domain_events.sequence_number AS "sequenceNumber",
                     domain_events.status,
                     domain_events.occurred_at AS "occurredAt",
                     domain_events.processing_at AS "processingAt",
                     domain_events.published_at AS "publishedAt",
                     domain_events.failed_at AS "failedAt",
                     domain_events.failure_reason AS "failureReason",
                     domain_events.created_at AS "createdAt"
        `)

        return yield* decodeDomainEventRows(rows.map(normalizeRawDomainEventRow)).pipe(
          Effect.mapError((error) => dbDecodeFailed('domain event list decode failed', error))
        )
      })
    ),

  markPublished: (ids: ReadonlyArray<string>) =>
    withDb('Failed to mark domain events as published', (db) =>
      Effect.gen(function* () {
        if (ids.length === 0) {
          return { updated: 0 }
        }

        const rows = yield* db
          .update(domainEvents)
          .set({ status: 'published', publishedAt: sql`now()` })
          .where(
            and(
              inArray(domainEvents.id, [...ids]),
              eq(domainEvents.status, 'processing')
            )
          )
          .returning({ id: domainEvents.id })
          .execute()

        return { updated: rows.length }
      })
    ),

  markFailed: (id: string, reason: string) =>
    withDb('Failed to mark domain event as failed', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(domainEvents)
          .set({ status: 'failed', failedAt: sql`now()`, failureReason: reason })
          .where(
            and(
              eq(domainEvents.id, id),
              eq(domainEvents.status, 'processing')
            )
          )
          .returning({ id: domainEvents.id })
          .execute()

        return { updated: rows.length }
      })
    ),

  resetStuckProcessing: (stuckThreshold: Date) =>
    withDb('Failed to reset stuck processing events', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(domainEvents)
          .set({ status: 'pending', processingAt: null })
          .where(
            and(
              eq(domainEvents.status, 'processing'),
              lte(domainEvents.processingAt, stuckThreshold)
            )
          )
          .returning({ id: domainEvents.id })
          .execute()

        return rows.map((row) => row.id)
      })
    ),

  prunePublished: (olderThan: Date) =>
    withDb('Failed to prune published domain events', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(domainEvents)
          .where(
            or(
              and(
                eq(domainEvents.status, 'published'),
                lte(domainEvents.publishedAt, olderThan)
              ),
              and(
                eq(domainEvents.status, 'failed'),
                lte(domainEvents.failedAt, olderThan)
              )
            )
          )
          .returning({ id: domainEvents.id })
          .execute()

        return { deleted: rows.length }
      })
    ),

  /**
   * Lock-free snapshot of the pending backlog for the outbox metrics.
   *
   * Deliberately does NOT use `FOR UPDATE`/`SKIP LOCKED` so the gauge reflects
   * true queue depth (and the true oldest pending event) regardless of rows
   * in-flight under another dispatcher replica's claim lock. `depth` is the
   * full count of `pending` rows (uncapped, unlike the per-tick claimed batch)
   * so the `critical-outbox-depth` alert can actually fire.
   */
  measureBacklog: () =>
    withDb('Failed to measure outbox backlog', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.execute<{
          depth: number | string
          oldest_age_seconds: number | string | null
        }>(sql`
          SELECT
            count(*) FILTER (WHERE status = 'pending') AS depth,
            COALESCE(
              EXTRACT(EPOCH FROM now() - min(occurred_at) FILTER (WHERE status = 'pending')),
              0
            ) AS oldest_age_seconds
          FROM domain_events
        `)

        const row = rows[0]
        return {
          depth: row ? Number(row.depth) : 0,
          oldestAgeSeconds: row ? Number(row.oldest_age_seconds) : 0
        }
      })
    )
}
