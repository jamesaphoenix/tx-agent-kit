import * as Schema from 'effect/Schema'

export const teamMemberRowSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  userId: Schema.UUID,
  roleId: Schema.NullOr(Schema.UUID),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type TeamMemberRowShape = Schema.Schema.Type<typeof teamMemberRowSchema>
