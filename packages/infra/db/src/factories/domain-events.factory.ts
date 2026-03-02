import type { DomainEventAggregateType, DomainEventStatus, DomainEventType } from '@tx-agent-kit/contracts'
import type { domainEvents, JsonObject } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type DomainEventInsert = typeof domainEvents.$inferInsert

export interface CreateDomainEventFactoryOptions {
  eventType: DomainEventType
  aggregateType: DomainEventAggregateType
  aggregateId?: string
  payload?: JsonObject
  correlationId?: string | null
  sequenceNumber?: number
  status?: DomainEventStatus
  occurredAt?: Date
  processingAt?: Date | null
  publishedAt?: Date | null
  failedAt?: Date | null
  failureReason?: string | null
  createdAt?: Date
}

export const createDomainEventFactory = (
  options: CreateDomainEventFactoryOptions
): DomainEventInsert => {
  return {
    id: generateId(),
    eventType: options.eventType,
    aggregateType: options.aggregateType,
    aggregateId: options.aggregateId ?? generateId(),
    payload: options.payload ?? {},
    correlationId: options.correlationId ?? null,
    sequenceNumber: options.sequenceNumber ?? 1,
    status: options.status ?? 'pending',
    occurredAt: options.occurredAt ?? generateTimestamp(),
    processingAt: options.processingAt ?? null,
    publishedAt: options.publishedAt ?? null,
    failedAt: options.failedAt ?? null,
    failureReason: options.failureReason ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
