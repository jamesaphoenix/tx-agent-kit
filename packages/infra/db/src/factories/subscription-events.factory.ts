import type { subscriptionEvents } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type SubscriptionEventInsert = typeof subscriptionEvents.$inferInsert

export interface CreateSubscriptionEventFactoryOptions {
  stripeEventId?: string
  eventType?: string
  organizationId?: string | null
  payload?: Record<string, string | number | boolean | null>
  processedAt?: Date | null
  createdAt?: Date
}

export const createSubscriptionEventFactory = (
  options: CreateSubscriptionEventFactoryOptions = {}
): SubscriptionEventInsert => {
  return {
    id: generateId(),
    stripeEventId: options.stripeEventId ?? generateUniqueValue('evt'),
    eventType: options.eventType ?? 'invoice.payment_succeeded',
    organizationId: options.organizationId ?? null,
    payload: options.payload ?? {},
    processedAt: options.processedAt ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
