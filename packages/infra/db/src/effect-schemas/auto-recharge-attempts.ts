import * as Schema from 'effect/Schema'

export const autoRechargeAttemptRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  amountDecimillicents: Schema.Number,
  status: Schema.String,
  stripePaymentIntentId: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  nextRetryAt: Schema.NullOr(Schema.DateFromSelf),
  retriedFromAttemptId: Schema.NullOr(Schema.UUID),
  createdAt: Schema.DateFromSelf,
  completedAt: Schema.NullOr(Schema.DateFromSelf)
})

export type AutoRechargeAttemptRowShape = Schema.Schema.Type<typeof autoRechargeAttemptRowSchema>
