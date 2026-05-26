export const memberRoles = ['admin', 'member', 'viewer'] as const
export type MemberRole = (typeof memberRoles)[number]

// Unified — all scopes use the same roles
export const orgMemberRoles = memberRoles
export type OrgMemberRole = MemberRole

export const teamMemberRoles = memberRoles
export type TeamMemberRole = MemberRole

export type InvitationRole = MemberRole

export const invitationAssignableRoles = ['admin', 'member'] as const
export type InvitationAssignableRole = (typeof invitationAssignableRoles)[number]

export const invitationStatuses = ['pending', 'accepted', 'revoked', 'expired'] as const
export type InvitationStatus = (typeof invitationStatuses)[number]

export const membershipTypes = ['team', 'client'] as const
export type MembershipType = (typeof membershipTypes)[number]

export const authLoginProviders = ['password', 'google'] as const
export type AuthLoginProvider = (typeof authLoginProviders)[number]

export const agentClientOpenApiParameterLocations = ['path', 'query', 'header', 'cookie'] as const
export type AgentClientOpenApiParameterLocation = (typeof agentClientOpenApiParameterLocations)[number]

export const authLoginAuditStatuses = ['success', 'failure'] as const
export type AuthLoginAuditStatus = (typeof authLoginAuditStatuses)[number]

export const authLoginAuditEventTypes = [
  'login_success',
  'login_failure',
  'password_reset_requested',
  'password_changed',
  'oauth_linked',
  'oauth_unlinked',
  'session_refreshed',
  'session_revoked',
  'account_deleted'
] as const
export type AuthLoginAuditEventType = (typeof authLoginAuditEventTypes)[number]

export const authRateLimitedPaths = ['/v1/auth/sign-in', '/v1/auth/sign-up', '/v1/auth/forgot-password', '/v1/auth/reset-password', '/v1/auth/refresh', '/v1/auth/google/start', '/v1/auth/google/callback', '/v1/auth/sign-out', '/v1/auth/sign-out-all'] as const
export type AuthRateLimitedPath = (typeof authRateLimitedPaths)[number]

export const subscriptionStatuses = ['active', 'inactive', 'trialing', 'past_due', 'canceled', 'paused', 'unpaid'] as const
export type SubscriptionStatus = (typeof subscriptionStatuses)[number]

export const usageCategories = [
  'text_generation', 'image_generation', 'video_generation', 'storage',
  // Legacy values — kept for backward compat with existing usage_records rows until data migration
  'openrouter_inference', 'workflow_execution', 'api_call'
] as const
export type UsageCategory = (typeof usageCategories)[number]

export const creditEntryTypes = ['purchase', 'usage', 'adjustment', 'refund', 'auto_recharge', 'reserve', 'release'] as const
export type CreditEntryType = (typeof creditEntryTypes)[number]

export const subscriptionPlanSlugs = ['try_me', 'pro', 'agency'] as const
export type SubscriptionPlanSlug = (typeof subscriptionPlanSlugs)[number]

export const autoRechargeStatuses = ['pending', 'succeeded', 'failed'] as const
export type AutoRechargeStatus = (typeof autoRechargeStatuses)[number]

export const organizationOnboardingStatuses = ['in_progress', 'completed'] as const

export const organizationOnboardingSteps = [
  'organization_profile',
  'workspace_setup',
  'goals',
  'spend_cap',
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

export const emailCampaignTypes = ['drip_sequence', 'broadcast'] as const
export type EmailCampaignType = (typeof emailCampaignTypes)[number]

export const emailCampaignStatuses = ['draft', 'active', 'paused', 'archived'] as const
export type EmailCampaignStatus = (typeof emailCampaignStatuses)[number]

export const emailEnrollmentStatuses = ['active', 'paused', 'completed', 'cancelled', 'failed'] as const
export type EmailEnrollmentStatus = (typeof emailEnrollmentStatuses)[number]

export const emailSendStatuses = ['pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'] as const
export type EmailSendStatus = (typeof emailSendStatuses)[number]

export const emailSuppressionReasons = ['hard_bounce', 'complaint', 'manual_unsubscribe'] as const
export type EmailSuppressionReason = (typeof emailSuppressionReasons)[number]

export const emailCancelReasons = ['user_unsubscribed', 'admin_cancelled', 'suppressed', 'campaign_archived'] as const
export type EmailCancelReason = (typeof emailCancelReasons)[number]

export const emailTriggerTypes = ['domain_event', 'manual', 'scheduled'] as const
export type EmailTriggerType = (typeof emailTriggerTypes)[number]

export const emailSourceSystems = ['campaigns', 'notifications', 'admin'] as const
export type EmailSourceSystem = (typeof emailSourceSystems)[number]

export const domainEventTypes = [
  'organization.created',
  'organization.deleted',
  'team.deleted',
  'billing.credits_purchased',
  'billing.credits_recharged',
  'billing.credits_refunded',
  'billing.credits_low_balance',
  'billing.usage_cap_warning',
  'billing.usage_cap_exceeded',
  'billing.payment_failed',
  'billing.dispute_created',
  'billing.dispute_resolved',
  'billing.subscription_cancelled',
  'billing.recharge_requires_action',
  'billing.welcome_credit_granted',
  'assets.thumbnail_requested',
  'email_campaigns.enrollment_triggered'
] as const
export type DomainEventType = (typeof domainEventTypes)[number]

export const domainEventAggregateTypes = ['organization', 'team', 'billing', 'assets', 'email_campaigns'] as const
export type DomainEventAggregateType = (typeof domainEventAggregateTypes)[number]

export const domainEventStatuses = ['pending', 'processing', 'published', 'failed'] as const
export type DomainEventStatus = (typeof domainEventStatuses)[number]

export const sortOrders = ['asc', 'desc'] as const
export type SortOrder = (typeof sortOrders)[number]

export const retentionTableNames = [
  'auth_login_sessions',
  'auth_login_refresh_tokens',
  'auth_login_oidc_states',
  'password_reset_tokens',
  'auth_login_audit_events',
  'subscription_events',
  'domain_events',
  'invitations'
] as const
export type RetentionTableName = (typeof retentionTableNames)[number]

export const workspaceIndustries = [
  'saas',
  'ecommerce',
  'healthcare',
  'finance',
  'education',
  'real_estate',
  'marketing_agency',
  'media_entertainment',
  'food_beverage',
  'travel_hospitality',
  'fitness_wellness',
  'fashion_beauty',
  'technology',
  'nonprofit',
  'other'
] as const
export type WorkspaceIndustry = (typeof workspaceIndustries)[number]

export const workspaceIndustryLabels: Record<WorkspaceIndustry, string> = {
  saas: 'SaaS',
  ecommerce: 'E-commerce',
  healthcare: 'Healthcare',
  finance: 'Finance',
  education: 'Education',
  real_estate: 'Real Estate',
  marketing_agency: 'Marketing Agency',
  media_entertainment: 'Media & Entertainment',
  food_beverage: 'Food & Beverage',
  travel_hospitality: 'Travel & Hospitality',
  fitness_wellness: 'Fitness & Wellness',
  fashion_beauty: 'Fashion & Beauty',
  technology: 'Technology',
  nonprofit: 'Nonprofit',
  other: 'Other'
}

export const reviewTokenPermissions = ['view', 'comment', 'approve', 'reject'] as const
export type ReviewTokenPermission = (typeof reviewTokenPermissions)[number]

export const assetTypes = ['image', 'video', 'audio', 'gif', 'document'] as const
export type AssetType = (typeof assetTypes)[number]

export const assetCategories = ['user_upload', 'render', 'template', 'green_screen_template', 'sound_effect', 'music', 'brand_asset', 'other'] as const
export type AssetCategory = (typeof assetCategories)[number]

export const processingStatuses = ['pending', 'processing', 'completed', 'failed'] as const
export type ProcessingStatus = (typeof processingStatuses)[number]

export const pendingUploadStatuses = ['pending', 'confirmed', 'expired', 'failed'] as const
export type PendingUploadStatus = (typeof pendingUploadStatuses)[number]

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
  'manage_api_keys',
  'view_assets',
  'upload_assets',
  'manage_assets',
  'delete_assets'
] as const
export type PermissionAction = (typeof permissionActions)[number]
