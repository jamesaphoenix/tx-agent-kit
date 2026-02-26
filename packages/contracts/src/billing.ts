import * as Schema from 'effect/Schema'
import {
  creditEntryTypes,
  subscriptionPlanSlugs,
  subscriptionStatuses,
  usageCategories
} from './literals.js'

export const DECIMILLICENTS_PER_CENT = 100_000
export const DECIMILLICENTS_PER_DOLLAR = 10_000_000

export const toDecimillicents = (dollars: number): number =>
  Math.round(dollars * DECIMILLICENTS_PER_DOLLAR)

export const fromDecimillicents = (decimillicents: number): number =>
  decimillicents / DECIMILLICENTS_PER_DOLLAR

export const usageCategorySchema = Schema.Literal(...usageCategories)
export const creditEntryTypeSchema = Schema.Literal(...creditEntryTypes)
export const billingSubscriptionPlanSlugSchema = Schema.Literal(...subscriptionPlanSlugs)
export const billingSubscriptionStatusSchema = Schema.Literal(...subscriptionStatuses)

export const billingSettingsSchema = Schema.Struct({
  organizationId: Schema.UUID,
  billingEmail: Schema.NullOr(Schema.String),
  stripeCustomerId: Schema.NullOr(Schema.String),
  stripeSubscriptionId: Schema.NullOr(Schema.String),
  stripePaymentMethodId: Schema.NullOr(Schema.String),
  stripeMeteredSubscriptionItemId: Schema.NullOr(Schema.String),
  creditsBalanceDecimillicents: Schema.Number,
  reservedCreditsDecimillicents: Schema.Number,
  autoRechargeEnabled: Schema.Boolean,
  autoRechargeThresholdDecimillicents: Schema.NullOr(Schema.Number),
  autoRechargeAmountDecimillicents: Schema.NullOr(Schema.Number),
  isSubscribed: Schema.Boolean,
  subscriptionStatus: billingSubscriptionStatusSchema,
  subscriptionPlan: Schema.NullOr(billingSubscriptionPlanSlugSchema),
  subscriptionStartedAt: Schema.NullOr(Schema.String),
  subscriptionEndsAt: Schema.NullOr(Schema.String),
  subscriptionCurrentPeriodEnd: Schema.NullOr(Schema.String)
})

export const usageRecordSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  quantity: Schema.Number,
  unitCostDecimillicents: Schema.Number,
  totalCostDecimillicents: Schema.Number,
  referenceId: Schema.NullOr(Schema.String),
  stripeUsageRecordId: Schema.NullOr(Schema.String),
  metadata: Schema.Unknown,
  recordedAt: Schema.String,
  createdAt: Schema.String
})

export const usageSummarySchema = Schema.Struct({
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  totalQuantity: Schema.Number,
  totalCostDecimillicents: Schema.Number
})

export const createCheckoutSessionSchema = Schema.Struct({
  organizationId: Schema.UUID,
  successUrl: Schema.String,
  cancelUrl: Schema.String
})

export const createPortalSessionSchema = Schema.Struct({
  organizationId: Schema.UUID,
  returnUrl: Schema.String
})

export const updateBillingSettingsSchema = Schema.Struct({
  billingEmail: Schema.optional(Schema.NullOr(Schema.String)),
  autoRechargeEnabled: Schema.optional(Schema.Boolean),
  autoRechargeThresholdDecimillicents: Schema.optional(Schema.NullOr(Schema.Number)),
  autoRechargeAmountDecimillicents: Schema.optional(Schema.NullOr(Schema.Number))
})

export const recordUsageInputSchema = Schema.Struct({
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  quantity: Schema.Number,
  unitCostDecimillicents: Schema.Number,
  referenceId: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.Unknown)
})

export const usageSummaryQuerySchema = Schema.Struct({
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  periodStart: Schema.String,
  periodEnd: Schema.String
})

export type BillingSettings = Schema.Schema.Type<typeof billingSettingsSchema>
export type UsageRecord = Schema.Schema.Type<typeof usageRecordSchema>
export type UsageSummary = Schema.Schema.Type<typeof usageSummarySchema>
export type CreateCheckoutSessionInput = Schema.Schema.Type<typeof createCheckoutSessionSchema>
export type CreatePortalSessionInput = Schema.Schema.Type<typeof createPortalSessionSchema>
export type UpdateBillingSettingsInput = Schema.Schema.Type<typeof updateBillingSettingsSchema>
export type RecordUsageInput = Schema.Schema.Type<typeof recordUsageInputSchema>
export type UsageSummaryQuery = Schema.Schema.Type<typeof usageSummaryQuerySchema>
