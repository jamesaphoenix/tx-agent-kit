import type { DomainEventAggregateType, DomainEventType } from '@tx-agent-kit/contracts'

export interface EmailCampaignsEnrollmentTriggeredEventPayload {
  campaignId: string
  userId: string
  userEmail: string
  userName: string
  enrollmentId: string
  triggerEventType: string
  triggerEventId: string
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[]

export interface EmailCampaignDomainEventInput {
  eventType: DomainEventType
  aggregateType: DomainEventAggregateType
  payload: { [key: string]: JsonValue }
  correlationId?: string | null
}
