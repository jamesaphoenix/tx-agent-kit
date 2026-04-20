import * as Schema from 'effect/Schema'
import { invitationStatuses, memberRoles, membershipTypes } from '@tx-agent-kit/contracts'

export const invitationStatusSchema = Schema.Literal(...invitationStatuses)
export const invitationRoleSchema = Schema.Literal(...memberRoles)
export const invitationMembershipTypeSchema = Schema.Literal(...membershipTypes)

export const invitationRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  inviteeUserId: Schema.NullOr(Schema.UUID),
  email: Schema.String,
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.DateFromSelf,
  revokedAt: Schema.NullOr(Schema.DateFromSelf),
  revokedByUserId: Schema.NullOr(Schema.UUID),
  teamId: Schema.NullOr(Schema.UUID),
  membershipType: invitationMembershipTypeSchema,
  createdAt: Schema.DateFromSelf
})

export type InvitationRowShape = Schema.Schema.Type<typeof invitationRowSchema>
