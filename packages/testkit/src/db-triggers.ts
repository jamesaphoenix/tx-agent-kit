export const organizationUpdatedAtTriggerName = 'update_organizations_updated_at' as const
export const orgMembersUpdatedAtTriggerName = 'update_org_members_updated_at' as const
export const invitationIdentityTriggerName = 'normalize_invitation_identity' as const

export const triggerFunctionNames = {
  updateUpdatedAtColumn: 'update_updated_at_column',
  normalizeInvitationIdentity: 'normalize_invitation_identity_fn'
} as const
