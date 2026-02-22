import * as Schema from 'effect/Schema'

export const invitationStatusSchema = Schema.Literal('pending', 'accepted', 'revoked', 'expired')
export const invitationRoleSchema = Schema.Literal('owner', 'admin', 'member')

export const invitationRowSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  inviteeUserId: Schema.NullOr(Schema.UUID),
  email: Schema.String,
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.DateFromSelf,
  createdAt: Schema.DateFromSelf
})

export type InvitationRowShape = Schema.Schema.Type<typeof invitationRowSchema>
