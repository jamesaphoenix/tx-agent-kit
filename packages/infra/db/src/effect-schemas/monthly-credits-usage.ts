import * as Schema from 'effect/Schema'

export const monthlyCreditsUsageRowSchema = Schema.Struct({
  id: Schema.UUID,
  orgId: Schema.UUID,
  periodStart: Schema.DateFromSelf,
  periodEnd: Schema.DateFromSelf,
  creditsUsed: Schema.Number,
  planTier: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf
})

export type MonthlyCreditsUsageRowShape = Schema.Schema.Type<typeof monthlyCreditsUsageRowSchema>
