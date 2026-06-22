import * as Schema from 'effect/Schema'

export const DomainEventSchema = Schema.Struct({
  id: Schema.UUID,
  eventType: Schema.String,
  aggregateType: Schema.String,
  aggregateId: Schema.UUID,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  correlationId: Schema.NullOr(Schema.UUID),
  sequenceNumber: Schema.Number,
  status: Schema.String,
  occurredAt: Schema.String,
  processingAt: Schema.NullOr(Schema.String),
  publishedAt: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String
})

export type DomainEvent = Schema.Schema.Type<typeof DomainEventSchema>

export const OutboxPollerInputSchema = Schema.Struct({
  batchSize: Schema.Number
})

export type OutboxPollerInput = Schema.Schema.Type<typeof OutboxPollerInputSchema>

export const OrganizationCreatedEventPayloadSchema = Schema.Struct({
  organizationName: Schema.String,
  ownerUserId: Schema.String,
  ownerEmail: Schema.String
})

export type OrganizationCreatedEventPayload = Schema.Schema.Type<typeof OrganizationCreatedEventPayloadSchema>

export const OrganizationDeletedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.String,
  organizationName: Schema.String,
  deletedByUserId: Schema.String
})

export type OrganizationDeletedEventPayload = Schema.Schema.Type<typeof OrganizationDeletedEventPayloadSchema>

export const TeamDeletedEventPayloadSchema = Schema.Struct({
  teamId: Schema.String,
  teamName: Schema.String,
  organizationId: Schema.String,
  deletedByUserId: Schema.String
})

export type TeamDeletedEventPayload = Schema.Schema.Type<typeof TeamDeletedEventPayloadSchema>

// --- Billing domain event payload schemas ---
// Shapes mirror the authoritative cross-domain event contract at
// `packages/core/src/domains/billing/domain/billing-events.ts`.

export const BillingCreditsPurchasedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  amountDecimillicents: Schema.Number,
  stripeEventId: Schema.String
})

export type BillingCreditsPurchasedEventPayload = Schema.Schema.Type<typeof BillingCreditsPurchasedEventPayloadSchema>

export const BillingCreditsRechargedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  amountDecimillicents: Schema.Number,
  stripePaymentIntentId: Schema.String
})

export type BillingCreditsRechargedEventPayload = Schema.Schema.Type<typeof BillingCreditsRechargedEventPayloadSchema>

export const BillingCreditsLowBalanceEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  currentBalanceDecimillicents: Schema.Number,
  thresholdDecimillicents: Schema.Number
})

export type BillingCreditsLowBalanceEventPayload = Schema.Schema.Type<typeof BillingCreditsLowBalanceEventPayloadSchema>

export const BillingUsageCapWarningEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  percentUsed: Schema.Number,
  capDecimillicents: Schema.Number
})

export type BillingUsageCapWarningEventPayload = Schema.Schema.Type<typeof BillingUsageCapWarningEventPayloadSchema>

export const BillingUsageCapExceededEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  capDecimillicents: Schema.Number
})

export type BillingUsageCapExceededEventPayload = Schema.Schema.Type<typeof BillingUsageCapExceededEventPayloadSchema>

export const BillingPaymentFailedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  stripeEventId: Schema.String,
  gracePeriodEndsAt: Schema.String
})

export type BillingPaymentFailedEventPayload = Schema.Schema.Type<typeof BillingPaymentFailedEventPayloadSchema>

export const BillingDisputeCreatedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  stripeEventId: Schema.String,
  chargeAmountDecimillicents: Schema.Number
})

export type BillingDisputeCreatedEventPayload = Schema.Schema.Type<typeof BillingDisputeCreatedEventPayloadSchema>

export const BillingDisputeResolvedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  outcome: Schema.Literal('won', 'lost')
})

export type BillingDisputeResolvedEventPayload = Schema.Schema.Type<typeof BillingDisputeResolvedEventPayloadSchema>

export const BillingSubscriptionCancelledEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID
})

export type BillingSubscriptionCancelledEventPayload = Schema.Schema.Type<typeof BillingSubscriptionCancelledEventPayloadSchema>

export const BillingRechargeRequiresActionEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  attemptId: Schema.UUID,
  amountDecimillicents: Schema.Number,
  stripePaymentIntentId: Schema.String,
  clientSecret: Schema.String
})

export type BillingRechargeRequiresActionEventPayload = Schema.Schema.Type<typeof BillingRechargeRequiresActionEventPayloadSchema>

export const BillingCreditsRefundedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  amountDecimillicents: Schema.Number,
  stripeEventId: Schema.String,
  stripeChargeId: Schema.String
})

export type BillingCreditsRefundedEventPayload = Schema.Schema.Type<typeof BillingCreditsRefundedEventPayloadSchema>

export const BillingWelcomeCreditGrantedEventPayloadSchema = Schema.Struct({
  organizationId: Schema.UUID,
  amountDecimillicents: Schema.Number,
  plan: Schema.Literal('try_me', 'pro', 'agency'),
  stripeEventId: Schema.String
})

export type BillingWelcomeCreditGrantedEventPayload = Schema.Schema.Type<typeof BillingWelcomeCreditGrantedEventPayloadSchema>

export const AssetsThumbnailRequestedEventPayloadSchema = Schema.Struct({
  assetId: Schema.UUID,
  teamId: Schema.UUID
})

export type AssetsThumbnailRequestedEventPayload = Schema.Schema.Type<typeof AssetsThumbnailRequestedEventPayloadSchema>

export const EmailCampaignsEnrollmentTriggeredEventPayloadSchema = Schema.Struct({
  campaignId: Schema.UUID,
  userId: Schema.UUID,
  userEmail: Schema.String,
  userName: Schema.String,
  enrollmentId: Schema.UUID,
  triggerEventType: Schema.String,
  triggerEventId: Schema.String
})

export type EmailCampaignsEnrollmentTriggeredEventPayload = Schema.Schema.Type<typeof EmailCampaignsEnrollmentTriggeredEventPayloadSchema>

// --- Lifecycle domain event payload schemas ---
// Shapes mirror the authoritative cross-domain event contract at
// `packages/core/src/domains/lifecycle/domain/lifecycle-events.ts`. Field-name
// parity is enforced by the domain-event-contracts structural lint. Every event
// carries only userId (+ a few domain-meaningful fields); the sweep looks up
// the user's email + name fresh from the DB at send time.

export const LifecycleSignedUpEventPayloadSchema = Schema.Struct({
  userId: Schema.String
})

export type LifecycleSignedUpEventPayload = Schema.Schema.Type<typeof LifecycleSignedUpEventPayloadSchema>

export const LifecycleTrialStartedEventPayloadSchema = Schema.Struct({
  userId: Schema.String
})

export type LifecycleTrialStartedEventPayload = Schema.Schema.Type<typeof LifecycleTrialStartedEventPayloadSchema>

export const LifecycleOnboardingCompletedEventPayloadSchema = Schema.Struct({
  userId: Schema.String,
  teamId: Schema.String,
  sinceDays: Schema.Number
})

export type LifecycleOnboardingCompletedEventPayload = Schema.Schema.Type<typeof LifecycleOnboardingCompletedEventPayloadSchema>

export const LifecycleWorkspaceActivatedEventPayloadSchema = Schema.Struct({
  userId: Schema.String,
  teamId: Schema.String,
  sinceDays: Schema.Number
})

export type LifecycleWorkspaceActivatedEventPayload = Schema.Schema.Type<typeof LifecycleWorkspaceActivatedEventPayloadSchema>

export const LifecycleFeatureUsedEventPayloadSchema = Schema.Struct({
  userId: Schema.String,
  teamId: Schema.String,
  feature: Schema.String
})

export type LifecycleFeatureUsedEventPayload = Schema.Schema.Type<typeof LifecycleFeatureUsedEventPayloadSchema>

export const LifecycleInactiveEventPayloadSchema = Schema.Struct({
  userId: Schema.String,
  teamId: Schema.String,
  inactiveDays: Schema.Number,
  lastActiveAt: Schema.String
})

export type LifecycleInactiveEventPayload = Schema.Schema.Type<typeof LifecycleInactiveEventPayloadSchema>

export const LifecycleChurnedEventPayloadSchema = Schema.Struct({
  userId: Schema.String,
  reason: Schema.Literal('subscription_cancelled', 'unsubscribed')
})

export type LifecycleChurnedEventPayload = Schema.Schema.Type<typeof LifecycleChurnedEventPayloadSchema>
