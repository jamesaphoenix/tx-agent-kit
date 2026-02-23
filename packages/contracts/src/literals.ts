export const workspaceMemberRoles = ['owner', 'admin', 'member'] as const
export type WorkspaceMemberRole = (typeof workspaceMemberRoles)[number]

export type InvitationRole = WorkspaceMemberRole

export const invitationAssignableRoles = ['admin', 'member'] as const
export type InvitationAssignableRole = (typeof invitationAssignableRoles)[number]

export const invitationStatuses = ['pending', 'accepted', 'revoked', 'expired'] as const
export type InvitationStatus = (typeof invitationStatuses)[number]

export const taskStatuses = ['todo', 'in_progress', 'done'] as const
export type TaskStatus = (typeof taskStatuses)[number]

export const sortOrders = ['asc', 'desc'] as const
export type SortOrder = (typeof sortOrders)[number]
