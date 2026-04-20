import type { processedStripeEvents } from '../schema.js'
import { generateUniqueValue, generateTimestamp } from './factory-helpers.js'

type ProcessedStripeEventInsert = typeof processedStripeEvents.$inferInsert

export interface CreateProcessedStripeEventFactoryOptions {
  eventId?: string
  processedAt?: Date
}

export const createProcessedStripeEventFactory = (
  options: CreateProcessedStripeEventFactoryOptions = {}
): ProcessedStripeEventInsert => ({
  eventId: options.eventId ?? generateUniqueValue('evt'),
  processedAt: options.processedAt ?? generateTimestamp()
})
