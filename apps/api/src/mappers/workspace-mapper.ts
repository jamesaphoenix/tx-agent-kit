import type { Invitation, Workspace } from '@tx-agent-kit/core'

export const toApiWorkspace = (workspace: Workspace) => ({
  id: workspace.id,
  name: workspace.name,
  ownerUserId: workspace.ownerUserId,
  createdAt: workspace.createdAt.toISOString()
})

export const toApiInvitation = (invitation: Invitation) => ({
  id: invitation.id,
  workspaceId: invitation.workspaceId,
  email: invitation.email,
  role: invitation.role === 'owner' ? 'admin' : invitation.role,
  status: invitation.status,
  invitedByUserId: invitation.invitedByUserId,
  token: invitation.token,
  expiresAt: invitation.expiresAt.toISOString(),
  createdAt: invitation.createdAt.toISOString()
})
