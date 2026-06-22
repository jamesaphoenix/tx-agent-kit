import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { DomainEventAggregateType, DomainEventType } from '@tx-agent-kit/contracts'
import type { JsonObject } from '@tx-agent-kit/db'

// Re-exported so the application layer references the outbox payload type through
// the port (it must not import @tx-agent-kit/db directly).
export type { JsonObject } from '@tx-agent-kit/db'

export const LifecycleRepositoryKind = 'custom' as const

/**
 * Emits a lifecycle.* event into the shared transactional outbox. The signup,
 * activity-scan, and churn emit paths depend on this single seam so every
 * lifecycle event is written the same way (and in the same transaction as the
 * action that triggered it, where applicable).
 */
export class LifecycleEventOutboxPort extends Context.Tag('LifecycleEventOutboxPort')<
  LifecycleEventOutboxPort,
  {
    emit: (input: {
      eventType: DomainEventType
      aggregateType: DomainEventAggregateType
      aggregateId: string
      payload: JsonObject
      correlationId?: string | null
    }) => Effect.Effect<void, unknown>
  }
>() {}
