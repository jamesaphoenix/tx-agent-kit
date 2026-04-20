import type {
  EmailCampaignType,
  EmailCampaignStatus
} from '@tx-agent-kit/contracts'
import type { emailCampaigns, JsonObject } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type EmailCampaignInsert = typeof emailCampaigns.$inferInsert

export interface CreateEmailCampaignFactoryOptions {
  id?: string
  name?: string
  description?: string | null
  campaignType?: EmailCampaignType
  status?: EmailCampaignStatus
  triggerConfig?: JsonObject | null
  audienceFilter?: JsonObject | null
  fromName?: string | null
  replyTo?: string | null
  createdBy?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export const createEmailCampaignFactory = (
  options: CreateEmailCampaignFactoryOptions = {}
): EmailCampaignInsert => {
  return {
    id: options.id ?? generateId(),
    name: options.name ?? generateUniqueValue('Campaign'),
    description: options.description ?? null,
    campaignType: options.campaignType ?? 'drip_sequence',
    status: options.status ?? 'draft',
    triggerConfig: options.triggerConfig ?? null,
    audienceFilter: options.audienceFilter ?? null,
    fromName: options.fromName ?? null,
    replyTo: options.replyTo ?? null,
    createdBy: options.createdBy ?? null,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
