import type { emailCampaignSteps, JsonObject } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type EmailCampaignStepInsert = typeof emailCampaignSteps.$inferInsert

export interface CreateEmailCampaignStepFactoryOptions {
  campaignId: string
  id?: string
  stepOrder?: number
  subject?: string
  templateId?: string
  templateData?: JsonObject
  delaySeconds?: number
  createdAt?: Date
  updatedAt?: Date
}

export const createEmailCampaignStepFactory = (
  options: CreateEmailCampaignStepFactoryOptions
): EmailCampaignStepInsert => {
  return {
    id: options.id ?? generateId(),
    campaignId: options.campaignId,
    stepOrder: options.stepOrder ?? 1,
    subject: options.subject ?? 'Test Email Subject',
    templateId: options.templateId ?? 'default-template',
    templateData: options.templateData ?? {},
    delaySeconds: options.delaySeconds ?? 0,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
