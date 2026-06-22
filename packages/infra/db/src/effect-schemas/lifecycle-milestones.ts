import * as Schema from 'effect/Schema'

export const lifecycleMilestoneRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.NullOr(Schema.UUID),
  teamId: Schema.NullOr(Schema.UUID),
  milestone: Schema.String,
  reachedAt: Schema.DateFromSelf
})

export type LifecycleMilestoneRowShape = Schema.Schema.Type<typeof lifecycleMilestoneRowSchema>
