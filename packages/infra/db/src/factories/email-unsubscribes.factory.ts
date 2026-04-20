import type { emailUnsubscribes } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type EmailUnsubscribeInsert = typeof emailUnsubscribes.$inferInsert

export interface CreateEmailUnsubscribeFactoryOptions {
  userId: string
  id?: string
  campaignId?: string | null
  unsubscribedAt?: Date
  createdAt?: Date
}

export const createEmailUnsubscribeFactory = (
  options: CreateEmailUnsubscribeFactoryOptions
): EmailUnsubscribeInsert => {
  return {
    id: options.id ?? generateId(),
    userId: options.userId,
    campaignId: options.campaignId ?? null,
    unsubscribedAt: options.unsubscribedAt ?? generateTimestamp(),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
