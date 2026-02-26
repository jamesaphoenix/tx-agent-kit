import type {
  CreditEntryType,
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

export interface BillingSettingsRecord {
  id: string
  billingEmail: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePaymentMethodId: string | null
  stripeMeteredSubscriptionItemId: string | null
  creditsBalance: number
  reservedCredits: number
  autoRechargeEnabled: boolean
  autoRechargeThreshold: number | null
  autoRechargeAmount: number | null
  isSubscribed: boolean
  subscriptionStatus: SubscriptionStatus
  subscriptionPlan: string | null
  subscriptionStartedAt: Date | null
  subscriptionEndsAt: Date | null
  subscriptionCurrentPeriodEnd: Date | null
}

export interface UsageRecordRecord {
  id: string
  organizationId: string
  category: UsageCategory
  quantity: number
  unitCostDecimillicents: number
  totalCostDecimillicents: number
  referenceId: string | null
  stripeUsageRecordId: string | null
  metadata: unknown
  recordedAt: Date
  createdAt: Date
}

export interface SubscriptionEventRecord {
  id: string
  stripeEventId: string
  eventType: string
  organizationId: string | null
  payload: unknown
  processedAt: Date | null
  createdAt: Date
}

export interface CreditLedgerEntryRecord {
  id: string
  organizationId: string
  amount: number
  entryType: CreditEntryType
  reason: string
  referenceId: string | null
  balanceAfter: number
  metadata: unknown
  createdAt: Date
}

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
  isSubscribed: boolean
  subscriptionStatus: SubscriptionStatus
  subscriptionPlan: SubscriptionPlanSlug | null
  subscriptionStartedAt: Date | null
  subscriptionEndsAt: Date | null
  subscriptionCurrentPeriodEnd: Date | null
}

export interface UsageRecord {
  id: string
  organizationId: string
  category: UsageCategory
  quantity: number
  unitCostDecimillicents: number
  totalCostDecimillicents: number
  referenceId: string | null
  stripeUsageRecordId: string | null
  metadata: unknown
  recordedAt: Date
  createdAt: Date
}

export interface UsageSummary {
  organizationId: string
  category: UsageCategory
  periodStart: Date
  periodEnd: Date
  totalQuantity: number
  totalCostDecimillicents: number
}

export interface CreateCheckoutSessionCommand {
  organizationId: string
  successUrl: string
  cancelUrl: string
}

export interface UpdateBillingSettingsCommand {
  billingEmail?: string | null
  autoRechargeEnabled?: boolean
  autoRechargeThresholdDecimillicents?: number | null
  autoRechargeAmountDecimillicents?: number | null
}

export interface CreatePortalSessionCommand {
  organizationId: string
  returnUrl: string
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
  pro: 1
}

const isSubscriptionPlanSlug = (value: string): value is SubscriptionPlanSlug =>
  value === 'pro'

export const isSubscriptionActive = (status: SubscriptionStatus): boolean =>
  status === 'active' || status === 'trialing'

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
  isSubscribed: row.isSubscribed,
  subscriptionStatus: row.subscriptionStatus,
  subscriptionPlan: row.subscriptionPlan && isSubscriptionPlanSlug(row.subscriptionPlan)
    ? row.subscriptionPlan
    : null,
  subscriptionStartedAt: row.subscriptionStartedAt,
  subscriptionEndsAt: row.subscriptionEndsAt,
  subscriptionCurrentPeriodEnd: row.subscriptionCurrentPeriodEnd
})

export const toUsageRecord = (row: UsageRecordRecord): UsageRecord => ({
  id: row.id,
  organizationId: row.organizationId,
  category: row.category,
  quantity: row.quantity,
  unitCostDecimillicents: row.unitCostDecimillicents,
  totalCostDecimillicents: row.totalCostDecimillicents,
  referenceId: row.referenceId,
  stripeUsageRecordId: row.stripeUsageRecordId,
  metadata: row.metadata,
  recordedAt: row.recordedAt,
  createdAt: row.createdAt
})
