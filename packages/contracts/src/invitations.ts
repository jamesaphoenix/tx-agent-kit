import * as Schema from 'effect/Schema'
import { emailSchema, paginatedResponseSchema } from './common.js'
import { invitationAssignableRoles, invitationStatuses } from './literals.js'

export const invitationStatusSchema = Schema.Literal(...invitationStatuses)
export const invitationRoleSchema = Schema.Literal(...invitationAssignableRoles)

export const invitationSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  email: emailSchema,
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String
})

export const createInvitationRequestSchema = Schema.Struct({
  organizationId: Schema.UUID,
  email: emailSchema,
  role: invitationRoleSchema
})

export const updateInvitationRequestSchema = Schema.Struct({
  role: Schema.optional(invitationRoleSchema),
  status: Schema.optional(invitationStatusSchema)
})

export const listInvitationsResponseSchema = paginatedResponseSchema(invitationSchema)

export const acceptInvitationResponseSchema = Schema.Struct({
  accepted: Schema.Boolean
})

export type Invitation = Schema.Schema.Type<typeof invitationSchema>
export type CreateInvitationRequest = Schema.Schema.Type<typeof createInvitationRequestSchema>
export type UpdateInvitationRequest = Schema.Schema.Type<typeof updateInvitationRequestSchema>
