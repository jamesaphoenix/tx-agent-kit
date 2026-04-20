import type { userUiPreferences } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type UserUiPreferenceInsert = typeof userUiPreferences.$inferInsert

export interface CreateUserUiPreferenceFactoryOptions {
  id?: string
  userId?: string
  organizationId?: string
  preferenceKey?: string
  dismissedAt?: Date
  createdAt?: Date
}

export const createUserUiPreferenceFactory = (
  options: CreateUserUiPreferenceFactoryOptions = {}
): UserUiPreferenceInsert => ({
  id: options.id ?? generateId(),
  userId: options.userId ?? generateId(),
  organizationId: options.organizationId ?? generateId(),
  preferenceKey: options.preferenceKey ?? 'billing.no_cap_reminder',
  dismissedAt: options.dismissedAt ?? generateTimestamp(),
  createdAt: options.createdAt ?? generateTimestamp()
})
