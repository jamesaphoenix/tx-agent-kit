import * as Schema from 'effect/Schema'
import { emailSuppressionReasonSchema, emailSourceSystemSchema } from './email-campaigns.js'

export const emailSuppressionListRowSchema = Schema.Struct({
  id: Schema.UUID,
  email: Schema.String,
  reason: emailSuppressionReasonSchema,
  sourceSystem: emailSourceSystemSchema,
  sourceId: Schema.NullOr(Schema.String),
  suppressedAt: Schema.DateFromSelf,
  liftedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type EmailSuppressionListRowShape = Schema.Schema.Type<typeof emailSuppressionListRowSchema>
