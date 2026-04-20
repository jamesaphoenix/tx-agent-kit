import * as Schema from 'effect/Schema'
import { jsonObjectSchema } from '../json-schema.js'

export const emailCampaignStepRowSchema = Schema.Struct({
  id: Schema.UUID,
  campaignId: Schema.UUID,
  stepOrder: Schema.Number,
  subject: Schema.String,
  templateId: Schema.String,
  templateData: jsonObjectSchema,
  delaySeconds: Schema.Number,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type EmailCampaignStepRowShape = Schema.Schema.Type<typeof emailCampaignStepRowSchema>
