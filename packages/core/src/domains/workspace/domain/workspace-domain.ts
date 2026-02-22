import type { Invitation, Workspace } from '@tx-agent-kit/contracts'

export interface WorkspaceRecord {
  id: string
  name: string
  ownerUserId: string
  createdAt: Date
}

export interface InvitationRecord {
  id: string
  workspaceId: string
  email: string
  role: 'owner' | 'admin' | 'member'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export const toWorkspace = (row: WorkspaceRecord): Workspace => ({
  id: row.id,
  name: row.name,
  ownerUserId: row.ownerUserId,
  createdAt: row.createdAt.toISOString()
})

export const toInvitation = (row: InvitationRecord): Invitation => ({
  id: row.id,
  workspaceId: row.workspaceId,
  email: row.email,
  role: row.role === 'owner' ? 'admin' : row.role,
  status: row.status,
  invitedByUserId: row.invitedByUserId,
  token: row.token,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString()
})
