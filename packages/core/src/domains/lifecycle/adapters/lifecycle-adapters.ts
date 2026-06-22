import { domainEventsRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import { mapNullable } from '../../../adapters/db-row-mappers.js'
import { LifecycleEventOutboxPort } from '../ports/lifecycle-ports.js'

/** Writes lifecycle.* events to the shared domain-events outbox. */
export const LifecycleEventOutboxDbLive = Layer.succeed(
  LifecycleEventOutboxPort,
  {
    emit: (input) =>
      domainEventsRepository.create({
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        correlationId: input.correlationId ?? null
      }).pipe(
        // Row->record mapping centralized via db-row-mappers (the created event
        // row is discarded; emit is fire-and-forget into the outbox).
        Effect.map((row) => mapNullable(row, (created) => created)),
        Effect.asVoid
      )
  }
)
