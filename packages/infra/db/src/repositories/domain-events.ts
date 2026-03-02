import { and, eq, inArray, lte, or, sql } from 'drizzle-orm'
import type { DomainEventType, DomainEventAggregateType } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB, type DbClient } from '../client.js'
import { domainEventRowSchema } from '../effect-schemas/domain-events.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { domainEvents, type JsonObject } from '../schema.js'

const decodeDomainEventRows = Schema.decodeUnknown(Schema.Array(domainEventRowSchema))
const decodeDomainEventRow = Schema.decodeUnknown(domainEventRowSchema)

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
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to create domain event', error))),

  fetchUnprocessed: (limit: number) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(domainEvents)
          .set({ status: 'processing', processingAt: sql`now()` })
          .where(
            inArray(
              domainEvents.id,
              sql`(SELECT id FROM domain_events WHERE status = 'pending' ORDER BY occurred_at ASC, id ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)`
            )
          )
          .returning({
            id: domainEvents.id,
            eventType: domainEvents.eventType,
            aggregateType: domainEvents.aggregateType,
            aggregateId: domainEvents.aggregateId,
            payload: domainEvents.payload,
            correlationId: domainEvents.correlationId,
            sequenceNumber: domainEvents.sequenceNumber,
            status: domainEvents.status,
            occurredAt: domainEvents.occurredAt,
            processingAt: domainEvents.processingAt,
            publishedAt: domainEvents.publishedAt,
            failedAt: domainEvents.failedAt,
            failureReason: domainEvents.failureReason,
            createdAt: domainEvents.createdAt
          })
          .execute()

        return yield* decodeDomainEventRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('domain event list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch unprocessed domain events', error))),

  markPublished: (ids: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        if (ids.length === 0) {
          return { updated: 0 }
        }

        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to mark domain events as published', error))),

  markFailed: (id: string, reason: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to mark domain event as failed', error))),

  resetStuckProcessing: (stuckThreshold: Date) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to reset stuck processing events', error))),

  prunePublished: (olderThan: Date) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to prune published domain events', error)))
}
