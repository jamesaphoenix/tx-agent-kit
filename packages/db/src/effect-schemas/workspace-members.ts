import * as Schema from 'effect/Schema'

export const membershipRoleSchema = Schema.Literal('owner', 'admin', 'member')

export const workspaceMemberRowSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  userId: Schema.UUID,
  role: membershipRoleSchema,
  createdAt: Schema.DateFromSelf
})

export type WorkspaceMemberRowShape = Schema.Schema.Type<typeof workspaceMemberRowSchema>
