import { sql } from 'drizzle-orm'
import {
  primaryKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex
} from 'drizzle-orm/pg-core'

export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'admin', 'member'])
export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'revoked', 'expired'])
export const taskStatusEnum = pgEnum('task_status', ['todo', 'in_progress', 'done'])

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
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

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: membershipRoleEnum('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  workspaceUserUnique: uniqueIndex('workspace_members_workspace_user_unique').on(table.workspaceId, table.userId)
}))

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  role: membershipRoleEnum('role').notNull().default('member'),
  status: invitationStatusEnum('status').notNull().default('pending'),
  invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  workspaceEmailPendingUnique: uniqueIndex('invitations_workspace_email_pending_unique').on(table.workspaceId, table.email)
    .where(sql`${table.status} = 'pending'`)
}))

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').notNull().default('todo'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  amount: text('amount').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const processedOperations = pgTable('processed_operations', {
  operationId: text('operation_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  processedOperationsPk: primaryKey({
    columns: [table.operationId, table.workspaceId, table.taskId],
    name: 'processed_operations_pkey'
  })
}))

export type UserRow = typeof users.$inferSelect
export type WorkspaceRow = typeof workspaces.$inferSelect
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect
export type InvitationRow = typeof invitations.$inferSelect
export type TaskRow = typeof tasks.$inferSelect
export type ProcessedOperationRow = typeof processedOperations.$inferSelect
