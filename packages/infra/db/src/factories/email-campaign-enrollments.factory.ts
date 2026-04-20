import type {
  EmailEnrollmentStatus,
  EmailCancelReason
} from '@tx-agent-kit/contracts'
import type { emailCampaignEnrollments } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type EmailCampaignEnrollmentInsert = typeof emailCampaignEnrollments.$inferInsert

export interface CreateEmailCampaignEnrollmentFactoryOptions {
  campaignId: string
  userId: string
  id?: string
  status?: EmailEnrollmentStatus
  currentStepOrder?: number | null
  temporalWorkflowId?: string | null
  enrolledAt?: Date
  completedAt?: Date | null
  cancelledAt?: Date | null
  cancelReason?: EmailCancelReason | null
  createdAt?: Date
  updatedAt?: Date
}

export const createEmailCampaignEnrollmentFactory = (
  options: CreateEmailCampaignEnrollmentFactoryOptions
): EmailCampaignEnrollmentInsert => {
  return {
    id: options.id ?? generateId(),
    campaignId: options.campaignId,
    userId: options.userId,
    status: options.status ?? 'active',
    currentStepOrder: options.currentStepOrder ?? null,
    temporalWorkflowId: options.temporalWorkflowId ?? null,
    enrolledAt: options.enrolledAt ?? generateTimestamp(),
    completedAt: options.completedAt ?? null,
    cancelledAt: options.cancelledAt ?? null,
    cancelReason: options.cancelReason ?? null,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
