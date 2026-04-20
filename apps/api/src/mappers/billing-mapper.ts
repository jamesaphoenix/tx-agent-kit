import type { SubscriptionPlanSlug, SubscriptionStatus } from '@tx-agent-kit/contracts'

export const toApiBillingSettings = (settings: {
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
  usageCapDecimillicents: number | null
  subscriptionCurrentPeriodEnd: Date | null
  suspendedAt: Date | null
  paymentGracePeriodEndsAt: Date | null
}) => ({
  organizationId: settings.organizationId,
  billingEmail: settings.billingEmail,
  stripeCustomerId: settings.stripeCustomerId,
  stripeSubscriptionId: settings.stripeSubscriptionId,
  stripePaymentMethodId: settings.stripePaymentMethodId,
  stripeMeteredSubscriptionItemId: settings.stripeMeteredSubscriptionItemId,
  creditsBalanceDecimillicents: settings.creditsBalanceDecimillicents,
  reservedCreditsDecimillicents: settings.reservedCreditsDecimillicents,
  autoRechargeEnabled: settings.autoRechargeEnabled,
  autoRechargeThresholdDecimillicents: settings.autoRechargeThresholdDecimillicents,
  autoRechargeAmountDecimillicents: settings.autoRechargeAmountDecimillicents,
  usageCapDecimillicents: settings.usageCapDecimillicents,
  isSubscribed: settings.isSubscribed,
  subscriptionStatus: settings.subscriptionStatus,
  subscriptionPlan: settings.subscriptionPlan,
  subscriptionStartedAt: settings.subscriptionStartedAt?.toISOString() ?? null,
  subscriptionEndsAt: settings.subscriptionEndsAt?.toISOString() ?? null,
  subscriptionCurrentPeriodEnd: settings.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
  suspendedAt: settings.suspendedAt?.toISOString() ?? null,
  paymentGracePeriodEndsAt: settings.paymentGracePeriodEndsAt?.toISOString() ?? null
})
