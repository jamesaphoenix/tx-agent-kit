import * as Schema from 'effect/Schema'
import {
  emailCampaignStatuses,
  emailCampaignTypes,
  emailEnrollmentStatuses,
  emailTriggerTypes
} from './literals.js'

// --- Trigger config (discriminated union) ---

export const triggerConfigDomainEventSchema = Schema.Struct({
  type: Schema.Literal(emailTriggerTypes[0]),
  eventType: Schema.String
})

export const triggerConfigManualSchema = Schema.Struct({
  type: Schema.Literal(emailTriggerTypes[1])
})

export const triggerConfigScheduledSchema = Schema.Struct({
  type: Schema.Literal(emailTriggerTypes[2]),
  cronExpression: Schema.String
})

export const triggerConfigSchema = Schema.Union(
  triggerConfigDomainEventSchema,
  triggerConfigManualSchema,
  triggerConfigScheduledSchema
)

// --- Campaign ---

export const campaignResponseSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  campaignType: Schema.Literal(...emailCampaignTypes),
  status: Schema.Literal(...emailCampaignStatuses),
  triggerConfig: Schema.Unknown,
  audienceFilter: Schema.Unknown,
  fromName: Schema.NullOr(Schema.String),
  replyTo: Schema.NullOr(Schema.String),
  createdBy: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const campaignListResponseSchema = Schema.Struct({
  data: Schema.Array(campaignResponseSchema)
})

export const createCampaignBodySchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  campaignType: Schema.Literal(...emailCampaignTypes),
  triggerConfig: Schema.optional(triggerConfigSchema),
  audienceFilter: Schema.optional(Schema.Unknown),
  fromName: Schema.optional(Schema.String),
  replyTo: Schema.optional(Schema.String)
})

export const updateCampaignBodySchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  triggerConfig: Schema.optional(triggerConfigSchema),
  audienceFilter: Schema.optional(Schema.Unknown),
  fromName: Schema.optional(Schema.String),
  replyTo: Schema.optional(Schema.String)
})

export const campaignListParamsSchema = Schema.Struct({
  status: Schema.optional(Schema.Literal(...emailCampaignStatuses)),
  campaignType: Schema.optional(Schema.Literal(...emailCampaignTypes))
})

// --- Campaign steps ---

export const campaignStepResponseSchema = Schema.Struct({
  id: Schema.String,
  campaignId: Schema.String,
  stepOrder: Schema.Number,
  subject: Schema.String,
  templateId: Schema.String,
  templateData: Schema.Unknown,
  delaySeconds: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const stepListResponseSchema = Schema.Struct({
  data: Schema.Array(campaignStepResponseSchema)
})

export const createStepBodySchema = Schema.Struct({
  subject: Schema.String,
  templateId: Schema.String,
  templateData: Schema.optional(Schema.Unknown),
  delaySeconds: Schema.optional(Schema.Number)
})

export const updateStepBodySchema = Schema.Struct({
  subject: Schema.optional(Schema.String),
  templateId: Schema.optional(Schema.String),
  templateData: Schema.optional(Schema.Unknown),
  delaySeconds: Schema.optional(Schema.Number)
})

// --- Enrollments ---

export const enrollmentResponseSchema = Schema.Struct({
  id: Schema.String,
  campaignId: Schema.String,
  userId: Schema.String,
  status: Schema.Literal(...emailEnrollmentStatuses),
  currentStepOrder: Schema.NullOr(Schema.Number),
  cancelReason: Schema.NullOr(Schema.String),
  temporalWorkflowId: Schema.NullOr(Schema.String),
  enrolledAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  cancelledAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const enrollmentListResponseSchema = Schema.Struct({
  data: Schema.Array(enrollmentResponseSchema)
})

export const enrollResultSchema = Schema.Struct({
  userId: Schema.String,
  enrolled: Schema.Boolean,
  enrollmentId: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String)
})

export const enrollUsersBodySchema = Schema.Struct({
  userIds: Schema.Array(Schema.String).pipe(Schema.minItems(1), Schema.maxItems(100))
})

export const enrollUsersResponseSchema = Schema.Struct({
  results: Schema.Array(enrollResultSchema)
})

// --- Analytics ---

export const campaignAnalyticsResponseSchema = Schema.Struct({
  campaignId: Schema.String,
  totalEnrollments: Schema.Number,
  activeEnrollments: Schema.Number,
  completedEnrollments: Schema.Number,
  cancelledEnrollments: Schema.Number,
  totalSends: Schema.Number,
  delivered: Schema.Number,
  opened: Schema.Number,
  clicked: Schema.Number,
  bounced: Schema.Number,
  complained: Schema.Number,
  failed: Schema.Number
})

export const stepAnalyticsResponseSchema = Schema.Struct({
  stepId: Schema.String,
  campaignId: Schema.String,
  totalSends: Schema.Number,
  delivered: Schema.Number,
  opened: Schema.Number,
  clicked: Schema.Number,
  bounced: Schema.Number,
  complained: Schema.Number,
  failed: Schema.Number
})

// --- Webhooks ---

export const resendWebhookResponseSchema = Schema.Struct({
  processed: Schema.Boolean
})

// --- Unsubscribe ---

export const unsubscribeTokenParamsSchema = Schema.Struct({
  token: Schema.optional(Schema.String)
})

export const unsubscribeVerifyResponseSchema = Schema.Struct({
  valid: Schema.Boolean,
  userId: Schema.String,
  campaignId: Schema.NullOr(Schema.String)
})

export const unsubscribeBodySchema = Schema.Struct({
  token: Schema.String
})

export const unsubscribeResponseSchema = Schema.Struct({
  unsubscribed: Schema.Boolean,
  userId: Schema.String,
  campaignId: Schema.NullOr(Schema.String)
})

// --- Type exports ---

export type CampaignResponse = Schema.Schema.Type<typeof campaignResponseSchema>
export type CampaignStepResponse = Schema.Schema.Type<typeof campaignStepResponseSchema>
export type EnrollmentResponse = Schema.Schema.Type<typeof enrollmentResponseSchema>
export type EnrollResult = Schema.Schema.Type<typeof enrollResultSchema>
export type CampaignAnalyticsResponse = Schema.Schema.Type<typeof campaignAnalyticsResponseSchema>
export type StepAnalyticsResponse = Schema.Schema.Type<typeof stepAnalyticsResponseSchema>
export type CreateCampaignBody = Schema.Schema.Type<typeof createCampaignBodySchema>
export type UpdateCampaignBody = Schema.Schema.Type<typeof updateCampaignBodySchema>
export type CreateStepBody = Schema.Schema.Type<typeof createStepBodySchema>
export type UpdateStepBody = Schema.Schema.Type<typeof updateStepBodySchema>
export type EnrollUsersBody = Schema.Schema.Type<typeof enrollUsersBodySchema>
export type CampaignListParams = Schema.Schema.Type<typeof campaignListParamsSchema>
export type TriggerConfig = Schema.Schema.Type<typeof triggerConfigSchema>
