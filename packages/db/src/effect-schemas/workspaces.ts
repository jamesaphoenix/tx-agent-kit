import * as Schema from 'effect/Schema'

export const workspaceRowSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  ownerUserId: Schema.UUID,
  organizationId: Schema.NullOr(Schema.UUID),
  createdAt: Schema.DateFromSelf
})

export type WorkspaceRowShape = Schema.Schema.Type<typeof workspaceRowSchema>
