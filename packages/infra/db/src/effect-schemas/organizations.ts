import * as Schema from 'effect/Schema'
import { organizationOnboardingDataSchema, subscriptionStatuses } from '@tx-agent-kit/contracts'

export const subscriptionStatusSchema = Schema.Literal(...subscriptionStatuses)
export const onboardingDataSchema = organizationOnboardingDataSchema

export const organizationRowSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  billingEmail: Schema.NullOr(Schema.String),
  onboardingData: Schema.NullOr(onboardingDataSchema),
  stripeCustomerId: Schema.NullOr(Schema.String),
  stripeSubscriptionId: Schema.NullOr(Schema.String),
  stripePaymentMethodId: Schema.NullOr(Schema.String),
  creditsBalance: Schema.Number,
  reservedCredits: Schema.Number,
  autoRechargeEnabled: Schema.Boolean,
  autoRechargeThreshold: Schema.NullOr(Schema.Number),
  autoRechargeAmount: Schema.NullOr(Schema.Number),
  isSubscribed: Schema.Boolean,
  subscriptionStatus: subscriptionStatusSchema,
  subscriptionPlan: Schema.NullOr(Schema.String),
  subscriptionStartedAt: Schema.NullOr(Schema.DateFromSelf),
  subscriptionEndsAt: Schema.NullOr(Schema.DateFromSelf),
  subscriptionCurrentPeriodEnd: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type OrganizationRowShape = Schema.Schema.Type<typeof organizationRowSchema>
