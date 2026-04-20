import type { notifications, JsonObject } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type NotificationInsert = typeof notifications.$inferInsert

export interface CreateNotificationFactoryOptions {
  id?: string
  organizationId?: string | null
  userId?: string | null
  eventType?: string
  title?: string
  body?: string
  metadata?: JsonObject
  readAt?: Date | null
  digestBatchId?: string | null
  emailedAt?: Date | null
  createdAt?: Date
}

/**
 * Factory for the `notifications` table. Keeps test seeding in sync with
 * the schema and gives callers a one-liner for the Phase 1 minimal-first
 * shape. Digest columns are defaulted to `null` so the caller can ignore
 * them until digest batching lands.
 */
export const createNotificationFactory = (
  options: CreateNotificationFactoryOptions = {}
): NotificationInsert => ({
  id: options.id ?? generateId(),
  organizationId: options.organizationId ?? null,
  userId: options.userId ?? null,
  eventType: options.eventType ?? 'billing.credits_low_balance',
  title: options.title ?? 'Low credit balance',
  body: options.body ?? 'Your available credit balance is running low.',
  metadata: options.metadata ?? {},
  readAt: options.readAt ?? null,
  digestBatchId: options.digestBatchId ?? null,
  emailedAt: options.emailedAt ?? null,
  createdAt: options.createdAt ?? generateTimestamp()
})
