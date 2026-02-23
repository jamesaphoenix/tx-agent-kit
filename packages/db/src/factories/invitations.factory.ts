import type { invitations } from '../schema.js'
import {
  invitationStatuses,
  workspaceMemberRoles,
  type InvitationRole,
  type InvitationStatus
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
  workspaceId: string
  invitedByUserId: string
  inviteeUserId?: string | null
  id?: string
  email?: string
  role?: InvitationRole
  status?: InvitationStatus
  token?: string
  expiresAt?: Date
  createdAt?: Date
}

export const createInvitationFactory = (
  options: CreateInvitationFactoryOptions
): InvitationInsert => {
  return {
    id: options.id ?? generateId(),
    workspaceId: options.workspaceId,
    inviteeUserId: options.inviteeUserId ?? null,
    email: options.email ?? generateEmail('invite'),
    role: options.role ?? workspaceMemberRoles[2],
    status: options.status ?? invitationStatuses[0],
    invitedByUserId: options.invitedByUserId,
    token: options.token ?? generateToken('invite'),
    expiresAt: options.expiresAt ?? generateFutureTimestamp(7 * 24 * 60 * 60 * 1000),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
