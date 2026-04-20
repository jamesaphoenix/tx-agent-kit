import * as Schema from 'effect/Schema'

export const emailUnsubscribeRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.UUID,
  campaignId: Schema.NullOr(Schema.UUID),
  unsubscribedAt: Schema.DateFromSelf,
  createdAt: Schema.DateFromSelf
})

export type EmailUnsubscribeRowShape = Schema.Schema.Type<typeof emailUnsubscribeRowSchema>
