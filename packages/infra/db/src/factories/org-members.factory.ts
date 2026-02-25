import type { orgMembers } from '../schema.js'
import {
  orgMemberRoles,
  membershipTypes,
  type OrgMemberRole,
  type MembershipType
} from '@tx-agent-kit/contracts'
import { generateId, generateTimestamp } from './factory-helpers.js'

type OrgMemberInsert = typeof orgMembers.$inferInsert

export interface CreateOrgMemberFactoryOptions {
  organizationId: string
  userId: string
  id?: string
  roleId?: string | null
  role?: OrgMemberRole
  membershipType?: MembershipType
  createdAt?: Date
  updatedAt?: Date
}

export const createOrgMemberFactory = (
  options: CreateOrgMemberFactoryOptions
): OrgMemberInsert => {
  return {
    id: options.id ?? generateId(),
    organizationId: options.organizationId,
    userId: options.userId,
    roleId: options.roleId ?? null,
    role: options.role ?? orgMemberRoles[2],
    membershipType: options.membershipType ?? membershipTypes[0],
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
