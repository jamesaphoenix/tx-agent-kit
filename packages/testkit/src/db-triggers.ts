export const workspaceOwnerMembershipTriggerName = 'trg_workspace_owner_membership' as const
export const invitationIdentityTriggerName = 'trg_normalize_invitation_identity' as const

export const triggerFunctionNames = {
  ensureWorkspaceOwnerMembership: 'ensure_workspace_owner_membership',
  normalizeInvitationIdentity: 'normalize_invitation_identity'
} as const
