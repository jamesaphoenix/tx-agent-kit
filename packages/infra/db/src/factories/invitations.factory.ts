import type { invitations } from '../schema.js'
import {
  type InvitationRole,
  type InvitationStatus,
  type MembershipType
} from '@tx-agent-kit/contracts'
import {
  generateEmail,
  generateFutureTimestamp,
  generateId,
  generateTimestamp,
  generateToken
} from './factory-helpers.js'

type InvitationInsert = typeof invitations.$inferInsert

export interface CreateInvitationFactoryOptions {
  organizationId: string
  invitedByUserId: string
  inviteeUserId?: string | null
  id?: string
  email?: string
  role?: InvitationRole
  status?: InvitationStatus
  token?: string
  expiresAt?: Date
  revokedAt?: Date | null
  revokedByUserId?: string | null
  teamId?: string | null
  membershipType?: MembershipType
  createdAt?: Date
}

export const createInvitationFactory = (
  options: CreateInvitationFactoryOptions
): InvitationInsert => {
  return {
    id: options.id ?? generateId(),
    organizationId: options.organizationId,
    inviteeUserId: options.inviteeUserId ?? null,
    email: options.email ?? generateEmail('invite'),
    role: options.role ?? 'member',
    status: options.status ?? 'pending',
    invitedByUserId: options.invitedByUserId,
    token: options.token ?? generateToken('invite'),
    expiresAt: options.expiresAt ?? generateFutureTimestamp(7 * 24 * 60 * 60 * 1000),
    revokedAt: options.revokedAt ?? null,
    revokedByUserId: options.revokedByUserId ?? null,
    teamId: options.teamId ?? null,
    membershipType: options.membershipType ?? 'team',
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
