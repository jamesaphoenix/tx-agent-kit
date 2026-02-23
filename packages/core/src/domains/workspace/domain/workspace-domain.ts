import {
  invitationAssignableRoles,
  invitationStatuses,
  type InvitationAssignableRole,
  type InvitationRole,
  type InvitationStatus,
  type WorkspaceMemberRole
} from '@tx-agent-kit/contracts'

export type {
  InvitationAssignableRole,
  InvitationRole,
  InvitationStatus,
  WorkspaceMemberRole
} from '@tx-agent-kit/contracts'

export interface WorkspaceRecord {
  id: string
  name: string
  ownerUserId: string
  createdAt: Date
}

export interface InvitationRecord {
  id: string
  workspaceId: string
  inviteeUserId: string | null
  email: string
  role: InvitationRole
  status: InvitationStatus
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export interface WorkspaceUserRecord {
  id: string
  email: string
  passwordHash: string
  name: string
  createdAt: Date
}

export interface Workspace {
  id: string
  name: string
  ownerUserId: string
  createdAt: Date
}

export interface Invitation {
  id: string
  workspaceId: string
  inviteeUserId: string | null
  email: string
  role: InvitationRole
  status: InvitationStatus
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export interface CreateWorkspaceCommand {
  name: string
}

export interface UpdateWorkspaceCommand {
  name?: string
}

export interface CreateInvitationCommand {
  workspaceId: string
  email: string
  role: InvitationAssignableRole
}

export interface UpdateInvitationCommand {
  role?: InvitationAssignableRole
  status?: InvitationStatus
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const minWorkspaceNameLength = 2
const maxWorkspaceNameLength = 64

export const normalizeInvitationEmail = (email: string): string => email.trim().toLowerCase()

export const isValidInvitationEmail = (email: string): boolean =>
  emailPattern.test(normalizeInvitationEmail(email))

export const normalizeWorkspaceName = (name: string): string => name.trim()

export const isValidWorkspaceName = (name: string): boolean => {
  const trimmed = normalizeWorkspaceName(name)
  return trimmed.length >= minWorkspaceNameLength && trimmed.length <= maxWorkspaceNameLength
}

export const canCreateInvitation = (role: WorkspaceMemberRole): boolean => role === 'owner' || role === 'admin'
export const canManageWorkspace = (role: WorkspaceMemberRole): boolean => role === 'owner' || role === 'admin'
export const canDeleteWorkspace = (role: WorkspaceMemberRole): boolean => role === 'owner'
export const canManageInvitation = (role: WorkspaceMemberRole): boolean => role === 'owner' || role === 'admin'

const isInvitationAssignableRole = (role: string): role is InvitationAssignableRole =>
  invitationAssignableRoles.some((value) => value === role)

const isInvitationStatus = (status: string): status is InvitationStatus =>
  invitationStatuses.some((value) => value === status)

export const isValidInvitationRoleUpdate = (
  role: string | undefined
): role is InvitationAssignableRole | undefined => role === undefined || isInvitationAssignableRole(role)

export const isValidInvitationStatusUpdate = (
  status: string | undefined
): status is InvitationStatus | undefined => status === undefined || isInvitationStatus(status)

export const toWorkspace = (row: WorkspaceRecord): Workspace => ({
  id: row.id,
  name: row.name,
  ownerUserId: row.ownerUserId,
  createdAt: row.createdAt
})

export const toInvitation = (row: InvitationRecord): Invitation => ({
  id: row.id,
  workspaceId: row.workspaceId,
  inviteeUserId: row.inviteeUserId,
  email: row.email,
  role: row.role,
  status: row.status,
  invitedByUserId: row.invitedByUserId,
  token: row.token,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt
})
