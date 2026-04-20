import type {
  OrganizationRowShape,
  UsageRecordRowShape,
  SubscriptionEventRowShape,
  CreditLedgerRowShape
} from '@tx-agent-kit/db'
import type {
  SubscriptionPlanSlug,
  SubscriptionStatus,
  UsageCategory
} from '@tx-agent-kit/contracts'

export type {
  CreditEntryType,
  SubscriptionPlanSlug,
  SubscriptionStatus,
  UsageCategory
} from '@tx-agent-kit/contracts'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export interface StripeWebhookEvent {
  id: string
  type: string
  payload: JsonObject
  data: {
    object: JsonObject
    /**
     * Stripe's `event.data.previous_attributes` — the subset of
     * `object` fields that changed in this event. Required for the
     * `charge.refunded` delta computation (amount_refunded is
     * cumulative, so we need the previous value to compute the
     * delta for THIS specific refund event). Present only on
     * update-style events; null when Stripe didn't send it.
     */
    previousAttributes: JsonObject | null
  }
}

// Extends row shape — billing settings are a subset of OrganizationRowShape fields.
export type BillingSettingsRecord = Pick<
  OrganizationRowShape,
  | 'id'
  | 'ownerUserId'
  | 'billingEmail'
  | 'stripeCustomerId'
  | 'stripeSubscriptionId'
  | 'stripePaymentMethodId'
  | 'stripeMeteredSubscriptionItemId'
  | 'usageCap'
  | 'creditsBalance'
  | 'reservedCredits'
  | 'autoRechargeEnabled'
  | 'autoRechargeThreshold'
  | 'autoRechargeAmount'
  | 'isSubscribed'
  | 'subscriptionStatus'
  | 'subscriptionPlan'
  | 'subscriptionStartedAt'
  | 'subscriptionEndsAt'
  | 'subscriptionCurrentPeriodEnd'
  | 'paymentGracePeriodEndsAt'
  | 'suspendedAt'
  | 'welcomeCreditGrantedAt'
>

export type UsageRecordRecord = UsageRecordRowShape

export type SubscriptionEventRecord = SubscriptionEventRowShape

export type CreditLedgerEntryRecord = CreditLedgerRowShape

export interface BillingSettings {
  organizationId: string
  billingEmail: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePaymentMethodId: string | null
  stripeMeteredSubscriptionItemId: string | null
  creditsBalanceDecimillicents: number
  reservedCreditsDecimillicents: number
  autoRechargeEnabled: boolean
  autoRechargeThresholdDecimillicents: number | null
  autoRechargeAmountDecimillicents: number | null
  usageCapDecimillicents: number | null
  isSubscribed: boolean
  subscriptionStatus: SubscriptionStatus
  subscriptionPlan: SubscriptionPlanSlug | null
  subscriptionStartedAt: Date | null
  subscriptionEndsAt: Date | null
  subscriptionCurrentPeriodEnd: Date | null
  paymentGracePeriodEndsAt: Date | null
  suspendedAt: Date | null
}

// Extends row shape — usage records are returned as-is from the DB.
export type UsageRecord = UsageRecordRowShape

export interface UsageSummary {
  organizationId: string
  category: UsageCategory
  periodStart: Date
  periodEnd: Date
  totalQuantity: number
  totalCostDecimillicents: number
}

export interface NoCapReminderPreferenceResult {
  dismissed: boolean
}
export type NoCapReminderPreference = NoCapReminderPreferenceResult

export interface AutoRechargeRequiresActionChallengeResult {
  attemptId: string
  amountDecimillicents: number
  stripePaymentIntentId: string
  clientSecret: string
}
export type AutoRechargeRequiresActionChallenge = AutoRechargeRequiresActionChallengeResult

export interface CreateCheckoutSessionCommand {
  organizationId: string
  subscriptionPlan: SubscriptionPlanSlug
  successUrl: string
  cancelUrl: string
}

export interface UpdateBillingSettingsCommand {
  billingEmail?: string | null
  autoRechargeEnabled?: boolean
  autoRechargeThresholdDecimillicents?: number | null
  autoRechargeAmountDecimillicents?: number | null
  usageCapDecimillicents?: number | null
}

export interface CreatePortalSessionCommand {
  organizationId: string
  returnUrl: string
}

export interface CompleteLocalBillingSetupCommand {
  subscriptionPlan: SubscriptionPlanSlug
}

/** Command for POST /v1/billing/:orgId/top-up — one-time credit purchase
 *  via a Stripe Checkout session in payment mode. */
export interface CreateTopUpSessionCommand {
  organizationId: string
  amountDecimillicents: number
  successUrl: string
  cancelUrl: string
}

export interface RecordUsageCommand {
  organizationId: string
  category: UsageCategory
  quantity: number
  unitCostDecimillicents: number
  referenceId?: string | null
  metadata?: JsonObject
}

export interface UsageSummaryCommand {
  organizationId: string
  category: UsageCategory
  periodStart: Date
  periodEnd: Date
}

const subscriptionPlanOrder: Record<'free' | SubscriptionPlanSlug, number> = {
  free: 0,
  try_me: 1,
  pro: 2,
  agency: 3
}

const isSubscriptionPlanSlug = (value: string): value is SubscriptionPlanSlug =>
  value === 'try_me' || value === 'pro' || value === 'agency'

export const isSubscriptionActive = (status: SubscriptionStatus): boolean =>
  status === 'active' || status === 'trialing' || status === 'past_due'

export const canAccessFeature = (
  plan: string | null,
  status: SubscriptionStatus,
  requiredPlan: 'free' | SubscriptionPlanSlug
): boolean => {
  if (!isSubscriptionActive(status)) {
    return false
  }

  if (requiredPlan === 'free') {
    return true
  }

  if (!plan || !isSubscriptionPlanSlug(plan)) {
    return false
  }

  return subscriptionPlanOrder[plan] >= subscriptionPlanOrder[requiredPlan]
}

export const isWithinUsageLimit = (
  currentUsage: number,
  limit: number | null
): boolean => (limit === null ? true : currentUsage <= limit)

export const isSubscriptionGuardSatisfied = (
  org: { subscriptionStatus: SubscriptionStatus; isSubscribed: boolean },
  guardEnabled: boolean
): boolean =>
  !guardEnabled || (org.isSubscribed && isSubscriptionActive(org.subscriptionStatus))

export const toBillingSettings = (row: BillingSettingsRecord): BillingSettings => ({
  organizationId: row.id,
  billingEmail: row.billingEmail,
  stripeCustomerId: row.stripeCustomerId,
  stripeSubscriptionId: row.stripeSubscriptionId,
  stripePaymentMethodId: row.stripePaymentMethodId,
  stripeMeteredSubscriptionItemId: row.stripeMeteredSubscriptionItemId,
  creditsBalanceDecimillicents: row.creditsBalance,
  reservedCreditsDecimillicents: row.reservedCredits,
  autoRechargeEnabled: row.autoRechargeEnabled,
  autoRechargeThresholdDecimillicents: row.autoRechargeThreshold,
  autoRechargeAmountDecimillicents: row.autoRechargeAmount,
  usageCapDecimillicents: row.usageCap,
  isSubscribed: row.isSubscribed,
  subscriptionStatus: row.subscriptionStatus,
  subscriptionPlan: row.subscriptionPlan && isSubscriptionPlanSlug(row.subscriptionPlan)
    ? row.subscriptionPlan
    : null,
  subscriptionStartedAt: row.subscriptionStartedAt,
  subscriptionEndsAt: row.subscriptionEndsAt,
  subscriptionCurrentPeriodEnd: row.subscriptionCurrentPeriodEnd,
  paymentGracePeriodEndsAt: row.paymentGracePeriodEndsAt,
  suspendedAt: row.suspendedAt
})
