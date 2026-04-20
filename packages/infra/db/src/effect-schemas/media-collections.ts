import * as Schema from 'effect/Schema'

export const mediaCollectionRowSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type MediaCollectionRowShape = Schema.Schema.Type<typeof mediaCollectionRowSchema>
