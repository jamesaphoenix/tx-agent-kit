import * as Schema from 'effect/Schema'
import { domainEventStatuses, domainEventTypes, domainEventAggregateTypes } from '@tx-agent-kit/contracts'
import { jsonObjectSchema } from '../json-schema.js'

export const domainEventRowSchema = Schema.Struct({
  id: Schema.UUID,
  eventType: Schema.Literal(...domainEventTypes),
  aggregateType: Schema.Literal(...domainEventAggregateTypes),
  aggregateId: Schema.UUID,
  payload: jsonObjectSchema,
  correlationId: Schema.NullOr(Schema.UUID),
  sequenceNumber: Schema.Number,
  status: Schema.Literal(...domainEventStatuses),
  occurredAt: Schema.DateFromSelf,
  processingAt: Schema.NullOr(Schema.DateFromSelf),
  publishedAt: Schema.NullOr(Schema.DateFromSelf),
  failedAt: Schema.NullOr(Schema.DateFromSelf),
  failureReason: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf
})

export type DomainEventRowShape = Schema.Schema.Type<typeof domainEventRowSchema>
