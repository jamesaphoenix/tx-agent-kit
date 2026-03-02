import type { DomainEventType, DomainEventAggregateType } from '@tx-agent-kit/contracts'

export interface OrganizationCreatedEventPayload {
  organizationName: string
  ownerUserId: string
  ownerEmail: string
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[]

export interface DomainEventInput {
  eventType: DomainEventType
  aggregateType: DomainEventAggregateType
  payload: { [key: string]: JsonValue }
  correlationId?: string | null
}
