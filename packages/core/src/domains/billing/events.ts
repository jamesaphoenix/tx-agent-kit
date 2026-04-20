/**
 * Public cross-domain event contract for the billing domain.
 *
 * This file is the ONLY file other domains may import from this domain.
 * It exposes event type discriminants, typed payload shapes, and version constants.
 *
 * Rules:
 * - Only event-related types belong here (payloads, discriminants, versions)
 * - Internal domain types, services, repos, and errors must NOT be exported here
 * - Consumers should import `type` only — these are data contracts, not runtime code
 *
 * @spec INV-BILLING-009 — events listed here are written to `domain_events` in
 * the same DB transaction as the mutation that causes them.
 */

export type {
  BillingCreditsPurchasedEventPayload,
  BillingCreditsRechargedEventPayload,
  BillingCreditsRefundedEventPayload,
  BillingCreditsLowBalanceEventPayload,
  BillingUsageCapWarningEventPayload,
  BillingUsageCapExceededEventPayload,
  BillingPaymentFailedEventPayload,
  BillingDisputeCreatedEventPayload,
  BillingDisputeResolvedEventPayload,
  BillingSubscriptionCancelledEventPayload,
  BillingRechargeRequiresActionEventPayload,
  BillingWelcomeCreditGrantedEventPayload
} from './domain/billing-events.js'

export const billingEvents = {
  creditsPurchased: 'billing.credits_purchased',
  creditsRecharged: 'billing.credits_recharged',
  creditsRefunded: 'billing.credits_refunded',
  creditsLowBalance: 'billing.credits_low_balance',
  usageCapWarning: 'billing.usage_cap_warning',
  usageCapExceeded: 'billing.usage_cap_exceeded',
  paymentFailed: 'billing.payment_failed',
  disputeCreated: 'billing.dispute_created',
  disputeResolved: 'billing.dispute_resolved',
  subscriptionCancelled: 'billing.subscription_cancelled',
  rechargeRequiresAction: 'billing.recharge_requires_action',
  welcomeCreditGranted: 'billing.welcome_credit_granted'
} as const

export const billingEventVersions = {
  'billing.credits_purchased': 1,
  'billing.credits_recharged': 1,
  'billing.credits_refunded': 1,
  'billing.credits_low_balance': 1,
  'billing.usage_cap_warning': 1,
  'billing.usage_cap_exceeded': 1,
  'billing.payment_failed': 1,
  'billing.dispute_created': 1,
  'billing.dispute_resolved': 1,
  'billing.subscription_cancelled': 1,
  'billing.recharge_requires_action': 1,
  'billing.welcome_credit_granted': 1
} as const
