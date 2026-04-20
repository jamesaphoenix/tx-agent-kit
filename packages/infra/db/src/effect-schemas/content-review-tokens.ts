import * as Schema from 'effect/Schema'

export const contentReviewTokenRowSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.DateFromSelf,
  revokedAt: Schema.NullOr(Schema.DateFromSelf),
  permissions: Schema.Array(Schema.String),
  reviewerName: Schema.NullOr(Schema.String),
  reviewerEmail: Schema.NullOr(Schema.String),
  lastAccessedAt: Schema.NullOr(Schema.DateFromSelf),
  createdBy: Schema.UUID,
  createdAt: Schema.DateFromSelf
})

export type ContentReviewTokenRow = Schema.Schema.Type<typeof contentReviewTokenRowSchema>
export type ContentReviewTokenRowShape = ContentReviewTokenRow
