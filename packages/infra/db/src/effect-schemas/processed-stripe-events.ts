import * as Schema from 'effect/Schema'

export const processedStripeEventRowSchema = Schema.Struct({
  eventId: Schema.String,
  processedAt: Schema.DateFromSelf
})

export type ProcessedStripeEventRowShape = Schema.Schema.Type<typeof processedStripeEventRowSchema>
