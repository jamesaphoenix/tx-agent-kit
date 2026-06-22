import type {
  EmailCampaignEnrollmentRowShape,
  EmailCampaignRowShape,
  EmailCampaignStepRowShape,
  EmailSendRowShape,
  EmailSuppressionListRowShape,
  EmailUnsubscribeRowShape
} from '@tx-agent-kit/db'
import type {
  EmailCampaignStatus,
  EmailCampaignType,
  EmailCancelReason,
  EmailEnrollmentStatus
} from '@tx-agent-kit/contracts'

export type {
  EmailCampaignStatus,
  EmailCampaignType,
  EmailCancelReason,
  EmailEnrollmentStatus,
  EmailSendStatus,
  EmailSourceSystem,
  EmailSuppressionReason,
  EmailTriggerType
} from '@tx-agent-kit/contracts'

// ---------------------------------------------------------------------------
// Record types — alias DB row shapes
// ---------------------------------------------------------------------------

export type CampaignRecord = EmailCampaignRowShape

export type CampaignStepRecord = EmailCampaignStepRowShape

export type EnrollmentRecord = EmailCampaignEnrollmentRowShape

export type EmailSendRecord = EmailSendRowShape

export type SuppressionRecord = EmailSuppressionListRowShape

export type UnsubscribeRecord = EmailUnsubscribeRowShape

// ---------------------------------------------------------------------------
// Command types (inputs)
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
  name: string
  description?: string | null
  campaignType: EmailCampaignType
  triggerConfig?: unknown
  audienceFilter?: unknown
  fromName?: string | null
  replyTo?: string | null
  createdBy?: string | null
}

export interface UpdateCampaignInput {
  name?: string
  description?: string | null
  triggerConfig?: unknown
  audienceFilter?: unknown
  fromName?: string | null
  replyTo?: string | null
  status?: CampaignRecord['status']
}

export type CampaignFilterParams = {
  status?: EmailCampaignStatus
  campaignType?: EmailCampaignType
}
export type CampaignFilter = CampaignFilterParams

export interface CreateEnrollmentInput {
  campaignId: string
  userId: string
  temporalWorkflowId?: string | null
  nextStepAt?: Date | null
}

export interface UpdateEnrollmentInput {
  status?: EmailEnrollmentStatus
  currentStepOrder?: number | null
  nextStepAt?: Date | null
  pausedRemainingSecs?: number | null
  sweepLeasedUntil?: Date | null
  cancelReason?: EmailCancelReason | null
  temporalWorkflowId?: string | null
  enrolledAt?: Date | null
  completedAt?: Date | null
  cancelledAt?: Date | null
}

export type EnrollmentFilterParams = {
  campaignId?: string
  userId?: string
  status?: EmailEnrollmentStatus
}
export type EnrollmentFilter = EnrollmentFilterParams

export interface CreateEmailSendInput {
  enrollmentId?: string | null
  stepId: string
  campaignId: string
  userId: string
  toEmail: string
  resendMessageId?: string | null
  metadata?: unknown
}

export type EmailSendTimestampsPayload = {
  sentAt?: Date | null
  deliveredAt?: Date | null
  openedAt?: Date | null
  clickedAt?: Date | null
  bouncedAt?: Date | null
  complainedAt?: Date | null
  failedReason?: string | null
}
export type EmailSendTimestamps = EmailSendTimestampsPayload

// ---------------------------------------------------------------------------
// Analytics types
// ---------------------------------------------------------------------------

export type CampaignAnalyticsResult = {
  campaignId: string
  totalEnrollments: number
  activeEnrollments: number
  completedEnrollments: number
  cancelledEnrollments: number
  totalSends: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  failed: number
}
export type CampaignAnalytics = CampaignAnalyticsResult

export type StepAnalyticsResult = {
  stepId: string
  campaignId: string
  totalSends: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  failed: number
}
export type StepAnalytics = StepAnalyticsResult
