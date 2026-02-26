import * as Schema from 'effect/Schema'
import { jsonObjectSchema } from '../json-schema.js'

export const subscriptionEventRowSchema = Schema.Struct({
  id: Schema.UUID,
  stripeEventId: Schema.String,
  eventType: Schema.String,
  organizationId: Schema.NullOr(Schema.UUID),
  payload: jsonObjectSchema,
  processedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type SubscriptionEventRowShape = Schema.Schema.Type<typeof subscriptionEventRowSchema>
