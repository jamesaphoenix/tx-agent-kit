import type { EmailSendStatus } from '@tx-agent-kit/contracts'
import type { emailSends, JsonObject } from '../schema.js'
import { generateEmail, generateId, generateTimestamp } from './factory-helpers.js'

type EmailSendInsert = typeof emailSends.$inferInsert

export interface CreateEmailSendFactoryOptions {
  campaignId: string
  stepId: string
  userId: string
  id?: string
  enrollmentId?: string | null
  toEmail?: string
  resendMessageId?: string | null
  status?: EmailSendStatus
  sentAt?: Date | null
  deliveredAt?: Date | null
  openedAt?: Date | null
  clickedAt?: Date | null
  bouncedAt?: Date | null
  complainedAt?: Date | null
  failedReason?: string | null
  metadata?: JsonObject
  createdAt?: Date
}

export const createEmailSendFactory = (
  options: CreateEmailSendFactoryOptions
): EmailSendInsert => {
  return {
    id: options.id ?? generateId(),
    enrollmentId: options.enrollmentId ?? null,
    campaignId: options.campaignId,
    stepId: options.stepId,
    userId: options.userId,
    toEmail: options.toEmail ?? generateEmail('send'),
    resendMessageId: options.resendMessageId ?? null,
    status: options.status ?? 'pending',
    sentAt: options.sentAt ?? null,
    deliveredAt: options.deliveredAt ?? null,
    openedAt: options.openedAt ?? null,
    clickedAt: options.clickedAt ?? null,
    bouncedAt: options.bouncedAt ?? null,
    complainedAt: options.complainedAt ?? null,
    failedReason: options.failedReason ?? null,
    metadata: options.metadata ?? {},
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
