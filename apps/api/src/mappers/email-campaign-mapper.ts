import type {
  CampaignRecord,
  CampaignStepRecord,
  EnrollmentRecord
} from '@tx-agent-kit/core'

const dateToIso = (date: Date): string => date.toISOString()

const nullableDateToIso = (date: Date | null): string | null =>
  date ? date.toISOString() : null

export const toApiCampaign = (campaign: CampaignRecord) => ({
  id: campaign.id,
  name: campaign.name,
  description: campaign.description,
  campaignType: campaign.campaignType,
  status: campaign.status,
  triggerConfig: campaign.triggerConfig,
  audienceFilter: campaign.audienceFilter,
  fromName: campaign.fromName,
  replyTo: campaign.replyTo,
  createdBy: campaign.createdBy,
  createdAt: dateToIso(campaign.createdAt),
  updatedAt: dateToIso(campaign.updatedAt)
})

export const toApiCampaignStep = (step: CampaignStepRecord) => ({
  id: step.id,
  campaignId: step.campaignId,
  stepOrder: step.stepOrder,
  subject: step.subject,
  templateId: step.templateId,
  templateData: step.templateData,
  delaySeconds: step.delaySeconds,
  createdAt: dateToIso(step.createdAt),
  updatedAt: dateToIso(step.updatedAt)
})

export const toApiEnrollment = (enrollment: EnrollmentRecord) => ({
  id: enrollment.id,
  campaignId: enrollment.campaignId,
  userId: enrollment.userId,
  status: enrollment.status,
  currentStepOrder: enrollment.currentStepOrder,
  cancelReason: enrollment.cancelReason,
  temporalWorkflowId: enrollment.temporalWorkflowId,
  enrolledAt: dateToIso(enrollment.enrolledAt),
  completedAt: nullableDateToIso(enrollment.completedAt),
  cancelledAt: nullableDateToIso(enrollment.cancelledAt),
  createdAt: dateToIso(enrollment.createdAt),
  updatedAt: dateToIso(enrollment.updatedAt)
})
