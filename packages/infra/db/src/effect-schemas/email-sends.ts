import * as Schema from 'effect/Schema'
import { emailSendStatusSchema } from './email-campaigns.js'
import { jsonObjectSchema } from '../json-schema.js'

export const emailSendRowSchema = Schema.Struct({
  id: Schema.UUID,
  enrollmentId: Schema.NullOr(Schema.UUID),
  campaignId: Schema.UUID,
  stepId: Schema.UUID,
  userId: Schema.UUID,
  toEmail: Schema.String,
  resendMessageId: Schema.NullOr(Schema.String),
  status: emailSendStatusSchema,
  sentAt: Schema.NullOr(Schema.DateFromSelf),
  deliveredAt: Schema.NullOr(Schema.DateFromSelf),
  openedAt: Schema.NullOr(Schema.DateFromSelf),
  clickedAt: Schema.NullOr(Schema.DateFromSelf),
  bouncedAt: Schema.NullOr(Schema.DateFromSelf),
  complainedAt: Schema.NullOr(Schema.DateFromSelf),
  failedReason: Schema.NullOr(Schema.String),
  metadata: jsonObjectSchema,
  createdAt: Schema.DateFromSelf
})

export type EmailSendRowShape = Schema.Schema.Type<typeof emailSendRowSchema>
