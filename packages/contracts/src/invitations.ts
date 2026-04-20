import * as Schema from 'effect/Schema'
import { emailSchema, listParamsSchema, paginatedResponseSchema } from './common.js'
import { invitationAssignableRoles, invitationStatuses, memberRoles, membershipTypes } from './literals.js'

export const invitationStatusSchema = Schema.Literal(...invitationStatuses)
export const invitationAssignableRoleSchema = Schema.Literal(...invitationAssignableRoles)
export const invitationRoleSchema = Schema.Literal(...memberRoles)
export const invitationMembershipTypeSchema = Schema.Literal(...membershipTypes)

export const invitationSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  email: emailSchema,
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
  revokedByUserId: Schema.NullOr(Schema.UUID),
  teamId: Schema.NullOr(Schema.UUID),
  membershipType: invitationMembershipTypeSchema,
  createdAt: Schema.String
})

export const createInvitationRequestSchema = Schema.Struct({
  organizationId: Schema.UUID,
  email: emailSchema,
  role: invitationAssignableRoleSchema,
  teamId: Schema.optional(Schema.UUID),
  membershipType: Schema.optional(invitationMembershipTypeSchema)
})

export const updateInvitationRequestSchema = Schema.Struct({
  role: Schema.optional(invitationAssignableRoleSchema),
  status: Schema.optional(invitationStatusSchema)
})

export const listInvitationsResponseSchema = paginatedResponseSchema(invitationSchema)

export const invitationSummarySchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  email: emailSchema,
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: Schema.UUID,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
  revokedByUserId: Schema.NullOr(Schema.UUID),
  teamId: Schema.NullOr(Schema.UUID),
  membershipType: invitationMembershipTypeSchema,
  createdAt: Schema.String
})

export const invitationsListParamsSchema = Schema.Struct({
  ...listParamsSchema.fields,
  'filter[status]': Schema.optional(Schema.String),
  'filter[role]': Schema.optional(Schema.String)
})

export const acceptInvitationResponseSchema = Schema.Struct({
  accepted: Schema.Boolean
})

export type Invitation = Schema.Schema.Type<typeof invitationSchema>
export type InvitationSummary = Schema.Schema.Type<typeof invitationSummarySchema>
export const listInvitationSummariesResponseSchema = paginatedResponseSchema(invitationSummarySchema)
export type CreateInvitationRequest = Schema.Schema.Type<typeof createInvitationRequestSchema>
export type UpdateInvitationRequest = Schema.Schema.Type<typeof updateInvitationRequestSchema>
