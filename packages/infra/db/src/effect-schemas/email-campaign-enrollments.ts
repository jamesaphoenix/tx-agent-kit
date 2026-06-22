import * as Schema from 'effect/Schema'
import { emailEnrollmentStatusSchema, emailCancelReasonSchema } from './email-campaigns.js'

export const emailCampaignEnrollmentRowSchema = Schema.Struct({
  id: Schema.UUID,
  campaignId: Schema.UUID,
  userId: Schema.UUID,
  status: emailEnrollmentStatusSchema,
  currentStepOrder: Schema.NullOr(Schema.Number),
  nextStepAt: Schema.NullOr(Schema.DateFromSelf),
  pausedRemainingSecs: Schema.NullOr(Schema.Number),
  sweepLeasedUntil: Schema.NullOr(Schema.DateFromSelf),
  temporalWorkflowId: Schema.NullOr(Schema.String),
  triggerEventType: Schema.NullOr(Schema.String),
  triggerEventId: Schema.NullOr(Schema.UUID),
  enrolledAt: Schema.DateFromSelf,
  completedAt: Schema.NullOr(Schema.DateFromSelf),
  cancelledAt: Schema.NullOr(Schema.DateFromSelf),
  cancelReason: Schema.NullOr(emailCancelReasonSchema),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type EmailCampaignEnrollmentRowShape = Schema.Schema.Type<typeof emailCampaignEnrollmentRowSchema>
