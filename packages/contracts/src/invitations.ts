import * as Schema from 'effect/Schema'
import { emailSchema } from './common.js'

export const invitationStatusSchema = Schema.Literal('pending', 'accepted', 'revoked', 'expired')
export const invitationRoleSchema = Schema.Literal('admin', 'member')

export const invitationSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  email: emailSchema,
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String
})

export const createInvitationRequestSchema = Schema.Struct({
  workspaceId: Schema.UUID,
  email: emailSchema,
  role: invitationRoleSchema
})

export const listInvitationsResponseSchema = Schema.Struct({
  invitations: Schema.Array(invitationSchema)
})

export const acceptInvitationResponseSchema = Schema.Struct({
  accepted: Schema.Boolean
})

export type Invitation = Schema.Schema.Type<typeof invitationSchema>
export type CreateInvitationRequest = Schema.Schema.Type<typeof createInvitationRequestSchema>
