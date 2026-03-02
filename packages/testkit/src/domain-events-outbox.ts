import type { Client } from 'pg'

export interface DomainEventRow {
  id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  payload: Record<string, unknown>
  correlation_id: string | null
  sequence_number: number
  status: string
  occurred_at: Date
  processing_at: Date | null
  published_at: Date | null
  failed_at: Date | null
  failure_reason: string | null
  created_at: Date
}

export const queryDomainEventsByAggregate = async (
  client: Client,
  aggregateType: string,
  aggregateId: string
): Promise<ReadonlyArray<DomainEventRow>> => {
  const result = await client.query<DomainEventRow>(
    `SELECT id, event_type, aggregate_type, aggregate_id, payload,
            correlation_id, sequence_number, status, occurred_at, processing_at,
            published_at, failed_at, failure_reason, created_at
     FROM domain_events
     WHERE aggregate_type = $1
       AND aggregate_id = $2
     ORDER BY occurred_at ASC, sequence_number ASC`,
    [aggregateType, aggregateId]
  )

  return result.rows
}

export const queryPendingDomainEvents = async (
  client: Client,
  limit = 50
): Promise<ReadonlyArray<DomainEventRow>> => {
  const result = await client.query<DomainEventRow>(
    `SELECT id, event_type, aggregate_type, aggregate_id, payload,
            correlation_id, sequence_number, status, occurred_at, processing_at,
            published_at, failed_at, failure_reason, created_at
     FROM domain_events
     WHERE status = 'pending'
     ORDER BY occurred_at ASC, id ASC
     LIMIT $1`,
    [limit]
  )

  return result.rows
}

export const updateDomainEventStatus = async (
  client: Client,
  eventId: string,
  status: 'published' | 'failed',
  failureReason?: string
): Promise<number> => {
  if (status === 'published') {
    const result = await client.query(
      `UPDATE domain_events SET status = 'published', published_at = now()
       WHERE id = $1 AND status = 'processing'`,
      [eventId]
    )
    return result.rowCount ?? 0
  } else {
    const result = await client.query(
      `UPDATE domain_events
       SET status = 'failed', failed_at = now(), failure_reason = $2
       WHERE id = $1 AND status = 'processing'`,
      [eventId, failureReason ?? 'unknown']
    )
    return result.rowCount ?? 0
  }
}

export const queryDomainEventById = async (
  client: Client,
  eventId: string
): Promise<DomainEventRow | null> => {
  const result = await client.query<DomainEventRow>(
    `SELECT id, event_type, aggregate_type, aggregate_id, payload,
            correlation_id, sequence_number, status, occurred_at, processing_at,
            published_at, failed_at, failure_reason, created_at
     FROM domain_events
     WHERE id = $1`,
    [eventId]
  )

  return result.rows[0] ?? null
}

export const claimPendingEventsForProcessing = async (
  client: Client,
  limit: number
): Promise<ReadonlyArray<DomainEventRow>> => {
  const result = await client.query<DomainEventRow>(
    `UPDATE domain_events
     SET status = 'processing', processing_at = now()
     WHERE status = 'pending'
       AND id IN (
         SELECT id FROM domain_events
         WHERE status = 'pending'
         ORDER BY occurred_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
     RETURNING id, event_type, aggregate_type, aggregate_id, payload,
               correlation_id, sequence_number, status, occurred_at, processing_at,
               published_at, failed_at, failure_reason, created_at`,
    [limit]
  )

  return result.rows
}

export const markProcessingEventsPublished = async (
  client: Client,
  eventIds: ReadonlyArray<string>
): Promise<number> => {
  if (eventIds.length === 0) {
    return 0
  }

  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(', ')
  const result = await client.query(
    `UPDATE domain_events
     SET status = 'published', published_at = now()
     WHERE id IN (${placeholders})
       AND status = 'processing'`,
    [...eventIds]
  )

  return result.rowCount ?? 0
}

export const markProcessingEventFailed = async (
  client: Client,
  eventId: string,
  reason: string
): Promise<number> => {
  const result = await client.query(
    `UPDATE domain_events
     SET status = 'failed', failed_at = now(), failure_reason = $2
     WHERE id = $1
       AND status = 'processing'`,
    [eventId, reason]
  )

  return result.rowCount ?? 0
}

export const resetStuckProcessingEvents = async (
  client: Client,
  stuckThreshold: Date
): Promise<ReadonlyArray<string>> => {
  const result = await client.query<{ id: string }>(
    `UPDATE domain_events
     SET status = 'pending', processing_at = NULL
     WHERE status = 'processing'
       AND processing_at <= $1
     RETURNING id`,
    [stuckThreshold]
  )

  return result.rows.map((row) => row.id)
}

export const backdateProcessingAt = async (
  client: Client,
  eventId: string,
  timestamp: Date
): Promise<void> => {
  await client.query(
    `UPDATE domain_events SET processing_at = $2 WHERE id = $1`,
    [eventId, timestamp]
  )
}

export const prunePublishedAndFailedEvents = async (
  client: Client,
  olderThan: Date
): Promise<number> => {
  const result = await client.query(
    `DELETE FROM domain_events
     WHERE (status = 'published' AND published_at <= $1)
        OR (status = 'failed' AND failed_at <= $1)`,
    [olderThan]
  )

  return result.rowCount ?? 0
}

export const backdatePublishedAt = async (
  client: Client,
  eventId: string,
  timestamp: Date
): Promise<void> => {
  await client.query(
    `UPDATE domain_events SET published_at = $2 WHERE id = $1`,
    [eventId, timestamp]
  )
}

export const backdateFailedAt = async (
  client: Client,
  eventId: string,
  timestamp: Date
): Promise<void> => {
  await client.query(
    `UPDATE domain_events SET failed_at = $2 WHERE id = $1`,
    [eventId, timestamp]
  )
}

export const insertDomainEventDirect = async (
  client: Client,
  input: {
    eventType: string
    aggregateType: string
    aggregateId: string
    payload?: Record<string, unknown>
    correlationId?: string | null
  }
): Promise<DomainEventRow> => {
  const result = await client.query<DomainEventRow>(
    `INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, correlation_id, sequence_number)
     VALUES ($1, $2, $3, $4, $5,
       (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM domain_events WHERE aggregate_id = $3))
     RETURNING id, event_type, aggregate_type, aggregate_id, payload,
               correlation_id, sequence_number, status, occurred_at, processing_at,
               published_at, failed_at, failure_reason, created_at`,
    [
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload ?? {}),
      input.correlationId ?? null
    ]
  )

  return result.rows[0]!
}
