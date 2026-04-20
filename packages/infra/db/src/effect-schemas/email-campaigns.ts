import * as Schema from 'effect/Schema'
import {
  emailCampaignTypes,
  emailCampaignStatuses,
  emailEnrollmentStatuses,
  emailSendStatuses,
  emailSuppressionReasons,
  emailCancelReasons,
  emailSourceSystems
} from '@tx-agent-kit/contracts'
import { jsonObjectSchema } from '../json-schema.js'

export const emailCampaignTypeSchema = Schema.Literal(...emailCampaignTypes)
export const emailCampaignStatusSchema = Schema.Literal(...emailCampaignStatuses)
export const emailEnrollmentStatusSchema = Schema.Literal(...emailEnrollmentStatuses)
export const emailSendStatusSchema = Schema.Literal(...emailSendStatuses)
export const emailSuppressionReasonSchema = Schema.Literal(...emailSuppressionReasons)
export const emailCancelReasonSchema = Schema.Literal(...emailCancelReasons)
export const emailSourceSystemSchema = Schema.Literal(...emailSourceSystems)

export const emailCampaignRowSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  campaignType: emailCampaignTypeSchema,
  status: emailCampaignStatusSchema,
  triggerConfig: Schema.NullOr(jsonObjectSchema),
  audienceFilter: Schema.NullOr(jsonObjectSchema),
  fromName: Schema.NullOr(Schema.String),
  replyTo: Schema.NullOr(Schema.String),
  createdBy: Schema.NullOr(Schema.UUID),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type EmailCampaignRowShape = Schema.Schema.Type<typeof emailCampaignRowSchema>
