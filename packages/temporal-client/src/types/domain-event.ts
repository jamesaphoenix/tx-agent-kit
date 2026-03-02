import * as Schema from 'effect/Schema'

export const DomainEventSchema = Schema.Struct({
  id: Schema.UUID,
  eventType: Schema.String,
  aggregateType: Schema.String,
  aggregateId: Schema.UUID,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  correlationId: Schema.NullOr(Schema.UUID),
  sequenceNumber: Schema.Number,
  status: Schema.String,
  occurredAt: Schema.String,
  processingAt: Schema.NullOr(Schema.String),
  publishedAt: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String
})

export type DomainEvent = Schema.Schema.Type<typeof DomainEventSchema>

export const OutboxPollerInputSchema = Schema.Struct({
  batchSize: Schema.Number
})

export type OutboxPollerInput = Schema.Schema.Type<typeof OutboxPollerInputSchema>

export const OrganizationCreatedEventPayloadSchema = Schema.Struct({
  organizationName: Schema.String,
  ownerUserId: Schema.String,
  ownerEmail: Schema.String
})

export type OrganizationCreatedEventPayload = Schema.Schema.Type<typeof OrganizationCreatedEventPayloadSchema>
