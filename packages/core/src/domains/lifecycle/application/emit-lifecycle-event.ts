import type { DomainEventType } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { LifecycleEventOutboxPort, type JsonObject } from '../ports/lifecycle-ports.js'

const LIFECYCLE_AGGREGATE = 'lifecycle' as const

/**
 * Emit a lifecycle.* event into the shared transactional outbox. The signup,
 * activity-scan, and churn emit paths call this so every lifecycle event is
 * written through one seam with the right aggregate type.
 */
export const emitLifecycleEvent = (input: {
  eventType: DomainEventType
  aggregateId: string
  payload: JsonObject
  correlationId?: string | null
}) =>
  Effect.gen(function* () {
    const outbox = yield* LifecycleEventOutboxPort
    yield* outbox.emit({
      eventType: input.eventType,
      aggregateType: LIFECYCLE_AGGREGATE,
      aggregateId: input.aggregateId,
      payload: input.payload,
      correlationId: input.correlationId ?? null
    })
  })
