import { sql } from 'drizzle-orm'
import {
  assetCategories,
  assetTypes,
  authLoginAuditEventTypes,
  authLoginAuditStatuses,
  authLoginProviders,
  domainEventStatuses,
  emailCampaignStatuses,
  emailCampaignTypes,
  emailCancelReasons,
  emailEnrollmentStatuses,
  emailSendStatuses,
  emailSourceSystems,
  emailSuppressionReasons,
  invitationStatuses,
  memberRoles,
  membershipTypes,
  pendingUploadStatuses,
  processingStatuses,
  subscriptionStatuses,
  type OrganizationOnboardingData
} from '@tx-agent-kit/contracts'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex
} from 'drizzle-orm/pg-core'

type OnboardingDataPayload = OrganizationOnboardingData

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export interface BrandSettingsPayload {
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
  }
  brandGuidelines: string
  industry: string
  targetAudience: string
}

export const memberRoleEnum = pgEnum('member_role', memberRoles)
export const invitationStatusEnum = pgEnum('invitation_status', invitationStatuses)
export const membershipTypeEnum = pgEnum('membership_type', membershipTypes)
export const subscriptionStatusEnum = pgEnum('subscription_status', subscriptionStatuses)
// auth_login_* enums/tables are strictly for first-party SaaS login/auth flows.
// They are intentionally separate from future third-party account-connection OAuth artifacts.
export const authLoginProviderEnum = pgEnum('auth_login_provider', authLoginProviders)
export const authLoginAuditStatusEnum = pgEnum('auth_login_audit_status', authLoginAuditStatuses)
export const authLoginAuditEventTypeEnum = pgEnum('auth_login_audit_event_type', authLoginAuditEventTypes)
export const domainEventStatusEnum = pgEnum('domain_event_status', domainEventStatuses)
export const assetTypeEnum = pgEnum('asset_type', assetTypes)
export const assetCategoryEnum = pgEnum('asset_category', assetCategories)
export const processingStatusEnum = pgEnum('processing_status', processingStatuses)
export const pendingUploadStatusEnum = pgEnum('pending_upload_status', pendingUploadStatuses)
export const emailCampaignTypeEnum = pgEnum('email_campaign_type', emailCampaignTypes)
export const emailCampaignStatusEnum = pgEnum('email_campaign_status', emailCampaignStatuses)
export const emailEnrollmentStatusEnum = pgEnum('email_enrollment_status', emailEnrollmentStatuses)
export const emailSendStatusEnum = pgEnum('email_send_status', emailSendStatuses)
export const emailSuppressionReasonEnum = pgEnum('email_suppression_reason', emailSuppressionReasons)
export const emailCancelReasonEnum = pgEnum('email_cancel_reason', emailCancelReasons)
export const emailSourceSystemEnum = pgEnum('email_source_system', emailSourceSystems)

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('users_email_ci_unique').on(sql`lower(trim(${table.email}))`)
])

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 minutes'`),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('password_reset_tokens_user_created_at_idx').on(
    table.userId,
    table.createdAt
  ),
  index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
  index('password_reset_tokens_user_expires_at_active_idx')
    .on(table.userId, table.expiresAt)
	.where(sql`${table.usedAt} IS NULL`)
])

// Active first-party login sessions for product authentication.
export const authLoginSessions = pgTable('auth_login_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authLoginProviderEnum('provider').notNull().default('password'),
  createdIp: text('created_ip'),
  createdUserAgent: text('created_user_agent'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_sessions_user_created_at_idx').on(table.userId, table.createdAt),
  index('auth_login_sessions_user_expires_at_idx').on(table.userId, table.expiresAt),
  index('auth_login_sessions_user_expires_at_active_idx')
    .on(table.userId, table.expiresAt)
	.where(sql`${table.revokedAt} IS NULL`)
])

// Refresh tokens that rotate/revoke first-party login sessions.
export const authLoginRefreshTokens = pgTable('auth_login_refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => authLoginSessions.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_refresh_tokens_session_created_at_idx').on(
    table.sessionId,
    table.createdAt
  ),
  index('auth_login_refresh_tokens_expires_at_idx').on(table.expiresAt),
  index('auth_login_refresh_tokens_session_expires_at_active_idx')
    .on(table.sessionId, table.expiresAt)
	.where(sql`${table.usedAt} IS NULL AND ${table.revokedAt} IS NULL`)
])

// OIDC state/nonce/PKCE records used only by first-party login callbacks.
export const authLoginOidcStates = pgTable('auth_login_oidc_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: authLoginProviderEnum('provider').notNull().default('google'),
  state: text('state').notNull().unique(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  requesterIp: text('requester_ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '10 minutes'`),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_oidc_states_provider_expires_at_idx').on(
    table.provider,
    table.expiresAt
  ),
  index('auth_login_oidc_states_expires_at_active_idx')
    .on(table.expiresAt)
	.where(sql`${table.consumedAt} IS NULL`)
])

// External identities linked for first-party login authentication.
export const authLoginIdentities = pgTable('auth_login_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authLoginProviderEnum('provider').notNull().default('google'),
  providerSubject: text('provider_subject').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('auth_login_identities_provider_subject_unique').on(
    table.provider,
    table.providerSubject
  ),
  uniqueIndex('auth_login_identities_user_provider_unique').on(
    table.userId,
    table.provider
  ),
  index('auth_login_identities_email_ci_idx').on(sql`lower(trim(${table.email}))`)
])

// Audit trail for first-party authentication/login security events.
export const authLoginAuditEvents = pgTable('auth_login_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: authLoginAuditEventTypeEnum('event_type').notNull(),
  status: authLoginAuditStatusEnum('status').notNull(),
  identifier: text('identifier'),
  ipAddress: text('ip_address'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_audit_events_user_created_at_idx').on(table.userId, table.createdAt),
  index('auth_login_audit_events_event_type_created_at_idx').on(
    table.eventType,
    table.createdAt
  )
])

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  billingEmail: text('billing_email'),
  onboardingData: jsonb('onboarding_data').$type<OnboardingDataPayload>(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePaymentMethodId: text('stripe_payment_method_id'),
  stripeMeteredSubscriptionItemId: text('stripe_metered_subscription_item_id'),
  creditsBalance: bigint('credits_balance', { mode: 'number' }).notNull().default(0),
  reservedCredits: bigint('reserved_credits', { mode: 'number' }).notNull().default(0),
  autoRechargeEnabled: boolean('auto_recharge_enabled').notNull().default(false),
  autoRechargeThreshold: bigint('auto_recharge_threshold', { mode: 'number' }),
  autoRechargeAmount: bigint('auto_recharge_amount', { mode: 'number' }),
  isSubscribed: boolean('is_subscribed').notNull().default(false),
  subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('inactive'),
  subscriptionPlan: text('subscription_plan'),
  subscriptionStartedAt: timestamp('subscription_started_at', { withTimezone: true }),
  subscriptionEndsAt: timestamp('subscription_ends_at', { withTimezone: true }),
  subscriptionCurrentPeriodEnd: timestamp('subscription_current_period_end', { withTimezone: true }),
  usageCap: bigint('usage_cap', { mode: 'number' }),
  paymentGracePeriodEndsAt: timestamp('payment_grace_period_ends_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  welcomeCreditGrantedAt: timestamp('welcome_credit_granted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('organizations_stripe_customer_id_unique')
    .on(table.stripeCustomerId)
    .where(sql`${table.stripeCustomerId} IS NOT NULL`),
  uniqueIndex('organizations_stripe_subscription_id_unique')
    .on(table.stripeSubscriptionId)
    .where(sql`${table.stripeSubscriptionId} IS NOT NULL`),
  index('organizations_name_id_idx').on(table.name, table.id),
  index('organizations_owner_user_id_idx').on(table.ownerUserId),
  index('organizations_suspended_at_partial_idx')
    .on(table.suspendedAt)
    .where(sql`${table.suspendedAt} IS NOT NULL`)
])

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('role_permissions_role_permission_unique').on(table.roleId, table.permissionId)
])

export const orgMembers = pgTable('org_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id),
  role: memberRoleEnum('role').notNull().default('member'),
  membershipType: membershipTypeEnum('membership_type').notNull().default('team'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('org_members_org_user_unique').on(table.organizationId, table.userId),
  index('org_members_org_id_idx').on(table.organizationId),
  index('org_members_user_id_idx').on(table.userId),
  index('org_members_user_created_at_idx').on(table.userId, table.createdAt),
  index('org_members_user_created_at_id_idx').on(table.userId, table.createdAt, table.id),
  index('org_members_org_created_at_id_idx').on(table.organizationId, table.createdAt, table.id),
  index('org_members_user_org_idx').on(table.userId, table.organizationId),
  index('org_members_role_id_idx').on(table.roleId)
])

export const userUiPreferences = pgTable('user_ui_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  preferenceKey: text('preference_key').notNull(),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('user_ui_preferences_user_org_key_unique').on(
    table.userId,
    table.organizationId,
    table.preferenceKey
  ),
  index('user_ui_preferences_org_user_idx').on(table.organizationId, table.userId)
])

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  website: text('website'),
  brandSettings: jsonb('brand_settings').$type<BrandSettingsPayload>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('teams_org_id_idx').on(table.organizationId),
  index('teams_name_id_idx').on(table.name, table.id),
  index('teams_org_name_id_idx').on(table.organizationId, table.name, table.id),
  index('teams_org_created_at_id_idx').on(table.organizationId, table.createdAt, table.id)
])

export const teamMembers = pgTable('team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id),
  role: memberRoleEnum('role').notNull().default('viewer'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId),
  index('team_members_team_id_idx').on(table.teamId),
  index('team_members_user_id_idx').on(table.userId),
  index('team_members_role_id_idx').on(table.roleId)
])

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  role: memberRoleEnum('role').notNull().default('member'),
  status: invitationStatusEnum('status').notNull().default('pending'),
  invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  membershipType: membershipTypeEnum('membership_type').notNull().default('team'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('invitations_org_email_orgwide_pending_unique').on(table.organizationId, table.email)
    .where(sql`${table.status} = 'pending' AND ${table.teamId} IS NULL`),
  uniqueIndex('invitations_org_email_team_pending_unique').on(table.organizationId, table.email, table.teamId)
    .where(sql`${table.status} = 'pending' AND ${table.teamId} IS NOT NULL`),
  index('invitations_invitee_user_created_at_id_idx').on(
    table.inviteeUserId,
    table.createdAt,
    table.id
  ),
  index('invitations_invitee_user_expires_at_id_idx').on(
    table.inviteeUserId,
    table.expiresAt,
    table.id
  ),
  index('idx_invitations_team_id').on(table.teamId)
    .where(sql`${table.teamId} IS NOT NULL`)
])

export const contentReviewTokens = pgTable('content_review_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  permissions: text('permissions').array().notNull().default(sql`'{"view"}'`),
  reviewerName: text('reviewer_name'),
  reviewerEmail: text('reviewer_email'),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('content_review_tokens_team_id_idx').on(table.teamId),
  index('content_review_tokens_expires_at_idx')
    .on(table.expiresAt)
    .where(sql`${table.revokedAt} IS NULL`)
])

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  amountDecimillicents: bigint('amount_decimillicents', { mode: 'number' }).notNull(),
  entryType: text('entry_type').notNull().default('adjustment'),
  reason: text('reason').notNull(),
  referenceId: text('reference_id'),
  stripeEventId: text('stripe_event_id'),
  assetId: uuid('asset_id'),
  phase: text('phase'),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('credit_ledger_org_created_at_idx').on(table.organizationId, table.createdAt),
  index('credit_ledger_reference_id_idx').on(table.referenceId),
  uniqueIndex('credit_ledger_stripe_event_id_unique_idx')
    .on(table.stripeEventId)
    .where(sql`${table.stripeEventId} IS NOT NULL`)
])

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  unitCostDecimillicents: bigint('unit_cost_decimillicents', { mode: 'number' }).notNull(),
  totalCostDecimillicents: bigint('total_cost_decimillicents', { mode: 'number' }).notNull(),
  // Stored as basis points: 1100 = 1.10x margin. BIGINT avoids float truncation.
  marginMultiplier: bigint('margin_multiplier', { mode: 'number' }),
  referenceId: text('reference_id'),
  assetId: uuid('asset_id'),
  stripeUsageRecordId: text('stripe_usage_record_id'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('usage_records_org_category_recorded_at_idx').on(
    table.organizationId,
    table.category,
    table.recordedAt
  ),
  index('usage_records_org_recorded_at_idx').on(table.organizationId, table.recordedAt),
  uniqueIndex('usage_records_org_reference_id_unique_idx')
    .on(table.organizationId, table.referenceId)
    .where(sql`${table.referenceId} IS NOT NULL`),
  index('usage_records_reference_id_idx').on(table.referenceId)
])

export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  stripeEventId: text('stripe_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('subscription_events_org_created_at_idx').on(table.organizationId, table.createdAt),
  index('subscription_events_event_type_created_at_idx').on(table.eventType, table.createdAt),
  index('subscription_events_unprocessed_idx')
    .on(table.createdAt)
    .where(sql`processed_at IS NULL`)
])

export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow()
})

export const monthlyCreditsUsage = pgTable('monthly_credits_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  creditsUsed: bigint('credits_used', { mode: 'number' }).notNull().default(0),
  planTier: text('plan_tier'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('monthly_credits_usage_org_period_unique').on(table.orgId, table.periodStart),
  index('monthly_credits_usage_org_id_idx').on(table.orgId)
])

export const storageUsage = pgTable('storage_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  currentBytes: bigint('current_bytes', { mode: 'number' }).notNull().default(0),
  planStorageLimit: bigint('plan_storage_limit', { mode: 'number' }).notNull(),
  planTier: text('plan_tier'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('storage_usage_org_period_unique').on(table.orgId, table.periodStart),
  index('storage_usage_org_id_idx').on(table.orgId)
])

export const autoRechargeAttempts = pgTable('auto_recharge_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  amountDecimillicents: bigint('amount_decimillicents', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('pending'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  failureReason: text('failure_reason'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  retriedFromAttemptId: uuid('retried_from_attempt_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, (table) => [
  index('auto_recharge_attempts_org_id_idx').on(table.organizationId),
  index('auto_recharge_attempts_status_idx').on(table.status),
  index('auto_recharge_attempts_next_retry_at_partial_idx')
    .on(table.nextRetryAt)
    .where(sql`${table.nextRetryAt} IS NOT NULL`),
  // At most one pending attempt per org. Serialises the check-then-insert
  // race in runAutoRechargeTrigger so concurrent credits_low_balance events
  // collapse to a single charge. @spec INV-BILLING-010
  uniqueIndex('auto_recharge_attempts_one_pending_per_org_uniq_idx')
    .on(table.organizationId)
    .where(sql`${table.status} = 'pending'`)
])

export const domainEvents = pgTable('domain_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  correlationId: uuid('correlation_id'),
  sequenceNumber: integer('sequence_number').notNull().default(1),
  status: domainEventStatusEnum('status').notNull().default('pending'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  processingAt: timestamp('processing_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('domain_events_pending_poller_idx')
    .on(table.occurredAt, table.id)
    .where(sql`${table.status} = 'pending'`),
  index('domain_events_stuck_processing_idx')
    .on(table.processingAt)
    .where(sql`${table.status} = 'processing'`),
  index('domain_events_prune_published_idx')
    .on(table.publishedAt)
    .where(sql`${table.status} = 'published'`),
  index('domain_events_prune_failed_idx')
    .on(table.failedAt)
    .where(sql`${table.status} = 'failed'`),
  index('domain_events_aggregate_stream_idx')
    .on(table.aggregateType, table.aggregateId),
  uniqueIndex('domain_events_aggregate_sequence_unique')
    .on(table.aggregateId, table.sequenceNumber)
])

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<JsonObject>().notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

// ---------------------------------------------------------------------------
// Assets domain tables
// ---------------------------------------------------------------------------

export const teamMediaAssets = pgTable('team_media_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  originalFilename: text('original_filename').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  mimeType: text('mime_type').notNull(),
  assetType: assetTypeEnum('asset_type').notNull(),
  assetCategory: assetCategoryEnum('asset_category').notNull().default('user_upload'),
  assetTypeData: jsonb('asset_type_data').$type<JsonObject>(),
  storagePath: text('storage_path').notNull(),
  thumbnailPath: text('thumbnail_path'),
  aiTitle: text('ai_title'),
  aiDescription: text('ai_description'),
  aiTags: text('ai_tags').array().notNull().default(sql`'{}'`),
  contentCategory: text('content_category'),
  emotion: jsonb('emotion').$type<JsonObject>(),
  purpose: text('purpose').array().notNull().default(sql`'{}'`),
  contentHash: text('content_hash'),
  processingStatus: processingStatusEnum('processing_status').notNull().default('pending'),
  processingError: text('processing_error'),
  embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
  embeddingModel: text('embedding_model'),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  hardDeletedAt: timestamp('hard_deleted_at', { withTimezone: true }),
  sharedWithOrg: boolean('shared_with_org').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('team_media_assets_team_id_is_deleted_idx').on(table.teamId, table.isDeleted),
  uniqueIndex('team_media_assets_team_content_hash_unique')
    .on(table.teamId, table.contentHash)
    .where(sql`is_deleted = false AND content_hash IS NOT NULL`),
  index('team_media_assets_team_created_at_idx').on(table.teamId, table.createdAt),
  index('team_media_assets_retention_scan_idx')
    .on(table.deletedAt)
    .where(sql`is_deleted = true AND hard_deleted_at IS NULL`)
])

export const pendingUploads = pgTable('pending_uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  declaredFileSize: bigint('declared_file_size', { mode: 'number' }).notNull(),
  contentHash: text('content_hash'),
  mimeType: text('mime_type').notNull(),
  storagePath: text('storage_path').notNull(),
  presignedUrl: text('presigned_url').notNull(),
  status: pendingUploadStatusEnum('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('pending_uploads_team_id_idx').on(table.teamId),
  index('pending_uploads_status_expires_at_idx')
    .on(table.status, table.expiresAt)
    .where(sql`${table.status} = 'pending'`)
])

export const storageMetering = pgTable('storage_metering', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }).unique(),
  activeBytes: bigint('active_bytes', { mode: 'number' }).notNull().default(0),
  softDeletedBytes: bigint('soft_deleted_bytes', { mode: 'number' }).notNull().default(0),
  activeAssetCount: integer('active_asset_count').notNull().default(0),
  softDeletedAssetCount: integer('soft_deleted_asset_count').notNull().default(0),
  highWaterMarkBytes: bigint('high_water_mark_bytes', { mode: 'number' }).notNull().default(0),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow()
})

export const mediaCollections = pgTable('media_collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('media_collections_team_id_idx').on(table.teamId),
  index('media_collections_team_name_idx').on(table.teamId, table.name)
])

export const collectionAssets = pgTable('collection_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id').notNull().references(() => mediaCollections.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => teamMediaAssets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('collection_assets_collection_asset_unique').on(table.collectionId, table.assetId),
  index('collection_assets_asset_id_idx').on(table.assetId)
])

export const dailyStorageSnapshots = pgTable('daily_storage_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  snapshotDate: text('snapshot_date').notNull(),
  highWaterMarkBytes: bigint('high_water_mark_bytes', { mode: 'number' }).notNull(),
  includedBytes: bigint('included_bytes', { mode: 'number' }).notNull(),
  overageBytes: bigint('overage_bytes', { mode: 'number' }).notNull().default(0),
  overageCostDecimillicents: bigint('overage_cost_decimillicents', { mode: 'number' }).notNull().default(0),
  ledgerEntryId: uuid('ledger_entry_id').references(() => creditLedger.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('daily_storage_snapshots_org_date_unique').on(table.organizationId, table.snapshotDate),
  index('daily_storage_snapshots_org_id_idx').on(table.organizationId)
])

export const emailCampaigns = pgTable('email_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  campaignType: emailCampaignTypeEnum('campaign_type').notNull(),
  status: emailCampaignStatusEnum('status').notNull().default('draft'),
  triggerConfig: jsonb('trigger_config').$type<JsonObject>(),
  audienceFilter: jsonb('audience_filter').$type<JsonObject>(),
  fromName: text('from_name'),
  replyTo: text('reply_to'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('idx_email_campaigns_status').on(table.status, table.createdAt.desc()),
  index('idx_email_campaigns_type').on(table.campaignType),
  index('idx_email_campaigns_trigger')
    .using('gin', table.triggerConfig)
    .where(sql`${table.status} = 'active'`)
])

export const emailCampaignSteps = pgTable('email_campaign_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  subject: text('subject').notNull(),
  templateId: text('template_id').notNull(),
  templateData: jsonb('template_data').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  delaySeconds: integer('delay_seconds').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('email_campaign_steps_campaign_step_order_unique').on(table.campaignId, table.stepOrder),
  index('idx_email_campaign_steps_campaign').on(table.campaignId, table.stepOrder)
])

export const emailCampaignEnrollments = pgTable('email_campaign_enrollments', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: emailEnrollmentStatusEnum('status').notNull().default('active'),
  currentStepOrder: integer('current_step_order'),
  temporalWorkflowId: text('temporal_workflow_id'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: emailCancelReasonEnum('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('email_campaign_enrollments_campaign_user_unique').on(table.campaignId, table.userId),
  index('idx_email_campaign_enrollments_campaign').on(table.campaignId, table.status),
  index('idx_email_campaign_enrollments_user').on(table.userId, table.status),
  index('idx_email_campaign_enrollments_status').on(table.status, table.enrolledAt)
])

export const emailSends = pgTable('email_sends', {
  id: uuid('id').defaultRandom().primaryKey(),
  enrollmentId: uuid('enrollment_id').references(() => emailCampaignEnrollments.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  stepId: uuid('step_id').notNull().references(() => emailCampaignSteps.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toEmail: text('to_email').notNull(),
  resendMessageId: text('resend_message_id'),
  status: emailSendStatusEnum('status').notNull().default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
  bouncedAt: timestamp('bounced_at', { withTimezone: true }),
  complainedAt: timestamp('complained_at', { withTimezone: true }),
  failedReason: text('failed_reason'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('idx_email_sends_resend_msg')
    .on(table.resendMessageId)
    .where(sql`${table.resendMessageId} IS NOT NULL`),
  index('idx_email_sends_campaign_step').on(table.campaignId, table.stepId, table.status),
  index('idx_email_sends_user').on(table.userId, table.createdAt.desc()),
  index('idx_email_sends_enrollment_step').on(table.enrollmentId, table.stepId),
  index('idx_email_sends_prune')
    .on(table.createdAt)
    .where(sql`${table.status} IN ('delivered', 'opened', 'clicked')`)
])

export const emailSuppressionList = pgTable('email_suppression_list', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  reason: emailSuppressionReasonEnum('reason').notNull(),
  sourceSystem: emailSourceSystemEnum('source_system').notNull(),
  sourceId: text('source_id'),
  suppressedAt: timestamp('suppressed_at', { withTimezone: true }).notNull().defaultNow(),
  liftedAt: timestamp('lifted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('idx_email_suppression_active')
    .on(sql`lower(${table.email})`)
    .where(sql`${table.liftedAt} IS NULL`),
  index('idx_email_suppression_email').on(sql`lower(${table.email})`)
])

export const emailUnsubscribes = pgTable('email_unsubscribes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('email_unsubscribes_user_campaign_unique')
    .on(table.userId, table.campaignId)
    .where(sql`${table.campaignId} IS NOT NULL`),
  uniqueIndex('email_unsubscribes_user_global_unique')
    .on(table.userId)
    .where(sql`${table.campaignId} IS NULL`),
  index('idx_email_unsubscribes_user').on(table.userId)
])

/**
 * Notifications — in-app notification feed + digest staging.
 *
 * Operational data (not a financial audit trail). Safe to delete on org
 * removal via ON DELETE CASCADE, and safe to prune on a retention policy.
 * Phase 1 scope is write + read + mark-read + unread-count only; digest
 * columns are present but idle until a future slice wires digest dispatch.
 *
 * @spec notifications-design §"Data Model"
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  readAt: timestamp('read_at', { withTimezone: true }),
  digestBatchId: uuid('digest_batch_id'),
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('notifications_user_org_created_at_idx')
    .on(table.userId, table.organizationId, table.createdAt),
  index('notifications_digest_batch_pending_idx')
    .on(table.digestBatchId)
    .where(sql`${table.digestBatchId} IS NOT NULL AND ${table.emailedAt} IS NULL`),
  index('notifications_org_event_type_created_at_idx')
    .on(table.organizationId, table.eventType, table.createdAt),
  uniqueIndex('notifications_outbox_event_id_user_org_uniq_idx')
    .on(table.userId, table.organizationId, sql`(${table.metadata}->>'outbox_event_id')`)
    .where(sql`${table.metadata}->>'outbox_event_id' IS NOT NULL`)
])

export type NotificationRow = typeof notifications.$inferSelect

export type UserRow = typeof users.$inferSelect
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect
export type AuthLoginSessionRow = typeof authLoginSessions.$inferSelect
export type AuthLoginRefreshTokenRow = typeof authLoginRefreshTokens.$inferSelect
export type AuthLoginOidcStateRow = typeof authLoginOidcStates.$inferSelect
export type AuthLoginIdentityRow = typeof authLoginIdentities.$inferSelect
export type AuthLoginAuditEventRow = typeof authLoginAuditEvents.$inferSelect
export type OrganizationRow = typeof organizations.$inferSelect
export type OrgMemberRow = typeof orgMembers.$inferSelect
export type TeamRow = typeof teams.$inferSelect
export type TeamMemberRow = typeof teamMembers.$inferSelect
export type InvitationRow = typeof invitations.$inferSelect
export type CreditLedgerRow = typeof creditLedger.$inferSelect
export type UsageRecordRow = typeof usageRecords.$inferSelect
export type SubscriptionEventRow = typeof subscriptionEvents.$inferSelect
export type DomainEventRow = typeof domainEvents.$inferSelect
export type SystemSettingRow = typeof systemSettings.$inferSelect
export type TeamMediaAssetRow = typeof teamMediaAssets.$inferSelect
export type PendingUploadRow = typeof pendingUploads.$inferSelect
export type StorageMeteringRow = typeof storageMetering.$inferSelect
export type MediaCollectionRow = typeof mediaCollections.$inferSelect
export type CollectionAssetRow = typeof collectionAssets.$inferSelect
export type DailyStorageSnapshotRow = typeof dailyStorageSnapshots.$inferSelect
export type EmailCampaignRow = typeof emailCampaigns.$inferSelect
export type EmailCampaignStepRow = typeof emailCampaignSteps.$inferSelect
export type EmailCampaignEnrollmentRow = typeof emailCampaignEnrollments.$inferSelect
export type EmailSendRow = typeof emailSends.$inferSelect
export type EmailSuppressionListRow = typeof emailSuppressionList.$inferSelect
export type EmailUnsubscribeRow = typeof emailUnsubscribes.$inferSelect
