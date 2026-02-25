import { sql } from 'drizzle-orm'
import {
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

export interface BrandSettingsPayload {
  primaryColor?: string
  logoUrl?: string
  metadata?: Record<string, string>
}

export const membershipRoleEnum = pgEnum('membership_role', orgMemberRoles)
export const invitationStatusEnum = pgEnum('invitation_status', invitationStatuses)
export const membershipTypeEnum = pgEnum('membership_type', membershipTypes)
export const subscriptionStatusEnum = pgEnum('subscription_status', subscriptionStatuses)

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

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  billingEmail: text('billing_email'),
  onboardingData: jsonb('onboarding_data').$type<OnboardingDataPayload>(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePaymentMethodId: text('stripe_payment_method_id'),
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
  amount: text('amount').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export type UserRow = typeof users.$inferSelect
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect
export type OrganizationRow = typeof organizations.$inferSelect
export type OrgMemberRow = typeof orgMembers.$inferSelect
export type TeamRow = typeof teams.$inferSelect
export type TeamMemberRow = typeof teamMembers.$inferSelect
export type InvitationRow = typeof invitations.$inferSelect
