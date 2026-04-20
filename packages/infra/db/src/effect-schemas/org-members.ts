import * as Schema from 'effect/Schema'
import { memberRoles, membershipTypes } from '@tx-agent-kit/contracts'

export const membershipRoleSchema = Schema.Literal(...memberRoles)
export const membershipTypeSchema = Schema.Literal(...membershipTypes)

export const orgMemberRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  userId: Schema.UUID,
  roleId: Schema.NullOr(Schema.UUID),
  role: membershipRoleSchema,
  membershipType: membershipTypeSchema,
  disabledAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type OrgMemberRowShape = Schema.Schema.Type<typeof orgMemberRowSchema>

export const orgMemberWithUserRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  userId: Schema.UUID,
  roleId: Schema.NullOr(Schema.UUID),
  role: membershipRoleSchema,
  membershipType: membershipTypeSchema,
  disabledAt: Schema.NullOr(Schema.DateFromSelf),
  userName: Schema.NullOr(Schema.String),
  userEmail: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type OrgMemberWithUserRowShape = Schema.Schema.Type<typeof orgMemberWithUserRowSchema>
