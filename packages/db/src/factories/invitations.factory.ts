import type { invitations } from '../schema.js'
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
  id?: string
  email?: string
  role?: 'owner' | 'admin' | 'member'
  status?: 'pending' | 'accepted' | 'revoked' | 'expired'
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
    email: options.email ?? generateEmail('invite'),
    role: options.role ?? 'member',
    status: options.status ?? 'pending',
    invitedByUserId: options.invitedByUserId,
    token: options.token ?? generateToken('invite'),
    expiresAt: options.expiresAt ?? generateFutureTimestamp(7 * 24 * 60 * 60 * 1000),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
