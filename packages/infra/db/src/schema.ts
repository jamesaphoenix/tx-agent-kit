import { sql } from 'drizzle-orm'
import {
  authLoginAuditEventTypes,
  authLoginAuditStatuses,
  authLoginProviders,
  invitationStatuses,
  membershipTypes,
  orgMemberRoles,
  subscriptionStatuses,
  type OrganizationOnboardingData
} from '@tx-agent-kit/contracts'
import {
  bigint,
  boolean,
  index,
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
  primaryColor?: string
  logoUrl?: string
  metadata?: Record<string, string>
}

export const membershipRoleEnum = pgEnum('membership_role', orgMemberRoles)
export const invitationStatusEnum = pgEnum('invitation_status', invitationStatuses)
export const membershipTypeEnum = pgEnum('membership_type', membershipTypes)
export const subscriptionStatusEnum = pgEnum('subscription_status', subscriptionStatuses)
// auth_login_* enums/tables are strictly for first-party SaaS login/auth flows.
// They are intentionally separate from future third-party account-connection OAuth artifacts.
export const authLoginProviderEnum = pgEnum('auth_login_provider', authLoginProviders)
export const authLoginAuditStatusEnum = pgEnum('auth_login_audit_status', authLoginAuditStatuses)
export const authLoginAuditEventTypeEnum = pgEnum('auth_login_audit_event_type', authLoginAuditEventTypes)

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  emailCiUnique: uniqueIndex('users_email_ci_unique').on(sql`lower(trim(${table.email}))`)
}))

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 minutes'`),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userCreatedAtIdx: index('password_reset_tokens_user_created_at_idx').on(
    table.userId,
    table.createdAt
  ),
  expiresAtIdx: index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
  activeUserExpiresAtIdx: index('password_reset_tokens_user_expires_at_active_idx')
    .on(table.userId, table.expiresAt)
	.where(sql`${table.usedAt} IS NULL`)
}))

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
}, (table) => ({
  userCreatedAtIdx: index('auth_login_sessions_user_created_at_idx').on(table.userId, table.createdAt),
  userExpiresAtIdx: index('auth_login_sessions_user_expires_at_idx').on(table.userId, table.expiresAt),
  activeSessionIdx: index('auth_login_sessions_user_expires_at_active_idx')
    .on(table.userId, table.expiresAt)
	.where(sql`${table.revokedAt} IS NULL`)
}))

// Refresh tokens that rotate/revoke first-party login sessions.
export const authLoginRefreshTokens = pgTable('auth_login_refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => authLoginSessions.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  sessionCreatedAtIdx: index('auth_login_refresh_tokens_session_created_at_idx').on(
    table.sessionId,
    table.createdAt
  ),
  expiresAtIdx: index('auth_login_refresh_tokens_expires_at_idx').on(table.expiresAt),
  sessionActiveExpiresAtIdx: index('auth_login_refresh_tokens_session_expires_at_active_idx')
    .on(table.sessionId, table.expiresAt)
	.where(sql`${table.usedAt} IS NULL AND ${table.revokedAt} IS NULL`)
}))

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
}, (table) => ({
  providerExpiresAtIdx: index('auth_login_oidc_states_provider_expires_at_idx').on(
    table.provider,
    table.expiresAt
  ),
  activeStateExpiresAtIdx: index('auth_login_oidc_states_expires_at_active_idx')
    .on(table.expiresAt)
	.where(sql`${table.consumedAt} IS NULL`)
}))

// External identities linked for first-party login authentication.
export const authLoginIdentities = pgTable('auth_login_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authLoginProviderEnum('provider').notNull().default('google'),
  providerSubject: text('provider_subject').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  providerSubjectUnique: uniqueIndex('auth_login_identities_provider_subject_unique').on(
    table.provider,
    table.providerSubject
  ),
  userProviderUnique: uniqueIndex('auth_login_identities_user_provider_unique').on(
    table.userId,
    table.provider
  ),
  userProviderIdx: index('auth_login_identities_user_provider_idx').on(table.userId, table.provider),
	emailCiIdx: index('auth_login_identities_email_ci_idx').on(sql`lower(trim(${table.email}))`)
}))

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
}, (table) => ({
  userCreatedAtIdx: index('auth_login_audit_events_user_created_at_idx').on(table.userId, table.createdAt),
  eventTypeCreatedAtIdx: index('auth_login_audit_events_event_type_created_at_idx').on(
    table.eventType,
    table.createdAt
  )
}))

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
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
}, (table) => ({
  rolePermissionUnique: uniqueIndex('role_permissions_role_permission_unique').on(table.roleId, table.permissionId)
}))

export const orgMembers = pgTable('org_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id),
  role: membershipRoleEnum('role').notNull().default('member'),
  membershipType: membershipTypeEnum('membership_type').notNull().default('team'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  orgUserUnique: uniqueIndex('org_members_org_user_unique').on(table.organizationId, table.userId),
  orgIdIdx: index('org_members_org_id_idx').on(table.organizationId),
  userIdIdx: index('org_members_user_id_idx').on(table.userId),
  roleIdIdx: index('org_members_role_id_idx').on(table.roleId)
}))

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  website: text('website'),
  brandSettings: jsonb('brand_settings').$type<BrandSettingsPayload>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  orgIdIdx: index('teams_org_id_idx').on(table.organizationId)
}))

export const teamMembers = pgTable('team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  teamUserUnique: uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId),
  teamIdIdx: index('team_members_team_id_idx').on(table.teamId),
  userIdIdx: index('team_members_user_id_idx').on(table.userId),
  roleIdIdx: index('team_members_role_id_idx').on(table.roleId)
}))

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  role: membershipRoleEnum('role').notNull().default('member'),
  status: invitationStatusEnum('status').notNull().default('pending'),
  invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  orgEmailPendingUnique: uniqueIndex('invitations_org_email_pending_unique').on(table.organizationId, table.email)
    .where(sql`${table.status} = 'pending'`),
  inviteeCreatedAtIdx: index('invitations_invitee_user_created_at_id_idx').on(
    table.inviteeUserId,
    table.createdAt,
    table.id
  ),
  inviteeExpiresAtIdx: index('invitations_invitee_user_expires_at_id_idx').on(
    table.inviteeUserId,
    table.expiresAt,
    table.id
  )
}))

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  entryType: text('entry_type').notNull().default('adjustment'),
  reason: text('reason').notNull(),
  referenceId: text('reference_id'),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  orgCreatedAtIdx: index('credit_ledger_org_created_at_idx').on(table.organizationId, table.createdAt),
  referenceIdIdx: index('credit_ledger_reference_id_idx').on(table.referenceId)
}))

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  unitCostDecimillicents: bigint('unit_cost_decimillicents', { mode: 'number' }).notNull(),
  totalCostDecimillicents: bigint('total_cost_decimillicents', { mode: 'number' }).notNull(),
  referenceId: text('reference_id'),
  stripeUsageRecordId: text('stripe_usage_record_id'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  orgCategoryRecordedAtIdx: index('usage_records_org_category_recorded_at_idx').on(
    table.organizationId,
    table.category,
    table.recordedAt
  ),
  orgRecordedAtIdx: index('usage_records_org_recorded_at_idx').on(table.organizationId, table.recordedAt),
  orgReferenceIdUniqueIdx: uniqueIndex('usage_records_org_reference_id_unique_idx').on(
    table.organizationId,
    table.referenceId
  ),
  referenceIdIdx: index('usage_records_reference_id_idx').on(table.referenceId)
}))

export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  stripeEventId: text('stripe_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  orgCreatedAtIdx: index('subscription_events_org_created_at_idx').on(table.organizationId, table.createdAt),
  eventTypeCreatedAtIdx: index('subscription_events_event_type_created_at_idx').on(table.eventType, table.createdAt)
}))

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
