import * as Schema from 'effect/Schema'
import { orgMemberRoles, membershipTypes } from '@tx-agent-kit/contracts'

export const membershipRoleSchema = Schema.Literal(...orgMemberRoles)
export const membershipTypeSchema = Schema.Literal(...membershipTypes)

export const orgMemberRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  userId: Schema.UUID,
  roleId: Schema.NullOr(Schema.UUID),
  role: membershipRoleSchema,
  membershipType: membershipTypeSchema,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type OrgMemberRowShape = Schema.Schema.Type<typeof orgMemberRowSchema>
