export const orgMemberRoles = ['owner', 'admin', 'member'] as const
export type OrgMemberRole = (typeof orgMemberRoles)[number]

export type InvitationRole = OrgMemberRole

export const invitationAssignableRoles = ['admin', 'member'] as const
export type InvitationAssignableRole = (typeof invitationAssignableRoles)[number]

export const invitationStatuses = ['pending', 'accepted', 'revoked', 'expired'] as const
export type InvitationStatus = (typeof invitationStatuses)[number]

export const membershipTypes = ['team', 'client'] as const
export type MembershipType = (typeof membershipTypes)[number]

export const subscriptionStatuses = ['active', 'inactive', 'trialing', 'past_due', 'canceled', 'paused', 'unpaid'] as const
export type SubscriptionStatus = (typeof subscriptionStatuses)[number]

export const organizationOnboardingStatuses = ['in_progress', 'completed'] as const

export const organizationOnboardingSteps = [
  'organization_profile',
  'workspace_setup',
  'goals',
  'completed'
] as const

export const organizationOnboardingGoals = [
  'agent_execution',
  'automation',
  'analytics',
  'internal_tools',
  'other'
] as const

export const organizationOnboardingTeamSizes = ['1-5', '6-20', '21-50', '51+'] as const

export const sortOrders = ['asc', 'desc'] as const
export type SortOrder = (typeof sortOrders)[number]

export const permissionActions = [
  'view_organization',
  'manage_organization',
  'manage_organization_members',
  'manage_billing',
  'manage_team_members',
  'assign_roles',
  'create_teams',
  'delete_teams',
  'view_workflows',
  'create_workflows',
  'edit_workflows',
  'delete_workflows',
  'execute_workflows',
  'view_analytics',
  'export_analytics',
  'manage_integrations',
  'manage_api_keys'
] as const
export type PermissionAction = (typeof permissionActions)[number]
