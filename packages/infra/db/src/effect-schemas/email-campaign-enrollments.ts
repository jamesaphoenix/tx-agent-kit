import * as Schema from 'effect/Schema'
import { emailEnrollmentStatusSchema, emailCancelReasonSchema } from './email-campaigns.js'

export const emailCampaignEnrollmentRowSchema = Schema.Struct({
  id: Schema.UUID,
  campaignId: Schema.UUID,
  userId: Schema.UUID,
  status: emailEnrollmentStatusSchema,
  currentStepOrder: Schema.NullOr(Schema.Number),
  temporalWorkflowId: Schema.NullOr(Schema.String),
  enrolledAt: Schema.DateFromSelf,
  completedAt: Schema.NullOr(Schema.DateFromSelf),
  cancelledAt: Schema.NullOr(Schema.DateFromSelf),
  cancelReason: Schema.NullOr(emailCancelReasonSchema),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type EmailCampaignEnrollmentRowShape = Schema.Schema.Type<typeof emailCampaignEnrollmentRowSchema>
