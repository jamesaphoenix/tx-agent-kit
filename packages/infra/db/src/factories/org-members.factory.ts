import type { orgMembers } from '../schema.js'
import {
  memberRoles,
  membershipTypes,
  type MemberRole,
  type MembershipType
} from '@tx-agent-kit/contracts'
import { generateId, generateTimestamp } from './factory-helpers.js'

type OrgMemberInsert = typeof orgMembers.$inferInsert

export interface CreateOrgMemberFactoryOptions {
  organizationId: string
  userId: string
  id?: string
  roleId?: string | null
  role?: MemberRole
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
    role: options.role ?? memberRoles[1],
    membershipType: options.membershipType ?? membershipTypes[0],
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
