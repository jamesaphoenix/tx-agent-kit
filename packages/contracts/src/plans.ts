import * as Schema from 'effect/Schema'
import {
  subscriptionPlanSlugs,
  type SubscriptionPlanSlug
} from './literals.js'

export const subscriptionPlanSlugSchema = Schema.Literal(...subscriptionPlanSlugs)

export interface PlanFeatureLimits {
  workflowExecutionsPerMonth: number | null
  apiCallsPerMonth: number | null
  /**
   * `null` means unlimited members. Every plan in the flat-rate storage-only
   * pricing model has unlimited team members — see
   * `INV-BILLING-NO-SEAT-LIMITS` in `specs/design/billing-and-pricing-design.md`.
   * The field is kept (not removed) so downstream callers that render
   * plan-feature tables can still display "Unlimited" explicitly.
   */
  teamMembers: number | null
  storageIncludedBytes: number
  storageOverageRateDecimillicentsPerGbMonth: number
}

export interface SubscriptionPlanDefinition {
  slug: SubscriptionPlanSlug
  displayName: string
  description: string
  pricePerMonthCents: number | null
  /**
   * Subscriptions in the flat-rate storage-only pricing model do NOT grant
   * recurring AI credits on renewal. The field is always 0 and callers must
   * not treat a non-zero value as a bundled-credit grant. The only credits
   * that arrive automatically are the one-time welcome credit on first
   * successful subscription charge (see {@link welcomeCreditDecimillicents}
   * and `WELCOME_CREDIT_DECIMILLICENTS` in `billing.ts`).
   *
   * @spec INV-BILLING-NO-BUNDLED-CREDITS
   */
  includedCreditsDecimillicents: 0
  stripePriceIdEnvKey: string
  featureLimits: PlanFeatureLimits
}

const GB = 1024 * 1024 * 1024

/**
 * Try Me — entry-tier flat-rate subscription.
 *
 * $19/mo buys 10 GB of storage, unlimited team members, and platform
 * access. No bundled AI credits — all AI usage is prepaid from the credit
 * wallet via one-time top-ups or auto-recharge. First successful charge
 * grants a one-time $9 welcome credit (see `WELCOME_CREDIT_DECIMILLICENTS`).
 *
 * @spec billing-and-pricing-design §"Plans"
 */
export const tryMePlanDefinition: SubscriptionPlanDefinition = {
  slug: 'try_me',
  displayName: 'Try Me',
  description:
    '$19/mo flat rate — 10 GB storage, unlimited members, platform access. AI usage billed via prepaid top-up wallet. First charge grants a one-time $9 welcome credit.',
  pricePerMonthCents: 1900,
  includedCreditsDecimillicents: 0,
  stripePriceIdEnvKey: 'STRIPE_TRY_ME_PRICE_ID',
  featureLimits: {
    workflowExecutionsPerMonth: null,
    apiCallsPerMonth: null,
    teamMembers: null,
    storageIncludedBytes: 10 * GB,
    storageOverageRateDecimillicentsPerGbMonth: 1_000_000 // $0.10/GB/month
  }
}

/**
 * Pro — mid-tier flat-rate subscription.
 *
 * $49/mo buys 100 GB of storage, unlimited team members, mid-tier rate
 * limits, and 48h email support. No bundled AI credits. First successful
 * charge grants a one-time $20 welcome credit.
 *
 * @spec billing-and-pricing-design §"Plans"
 */
export const proPlanDefinition: SubscriptionPlanDefinition = {
  slug: 'pro',
  displayName: 'Pro',
  description:
    '$49/mo flat rate — 100 GB storage, unlimited members, 48h email support. AI usage billed via prepaid top-up wallet. First charge grants a one-time $20 welcome credit.',
  pricePerMonthCents: 4900,
  includedCreditsDecimillicents: 0,
  stripePriceIdEnvKey: 'STRIPE_PRO_PRICE_ID',
  featureLimits: {
    workflowExecutionsPerMonth: null,
    apiCallsPerMonth: null,
    teamMembers: null,
    storageIncludedBytes: 100 * GB,
    storageOverageRateDecimillicentsPerGbMonth: 1_000_000 // $0.10/GB/month
  }
}

/**
 * Agency — high-tier flat-rate subscription.
 *
 * $199/mo buys 500 GB of storage, unlimited team members, high rate-limit
 * headroom, 24h email support + Slack access, and client collaboration
 * features. No bundled AI credits. First successful charge grants a
 * one-time $45 welcome credit. Storage overage discounted to $0.08/GB.
 *
 * @spec billing-and-pricing-design §"Plans"
 */
export const agencyPlanDefinition: SubscriptionPlanDefinition = {
  slug: 'agency',
  displayName: 'Agency',
  description:
    '$199/mo flat rate — 500 GB storage, unlimited members, 24h email + Slack support. AI usage billed via prepaid top-up wallet. First charge grants a one-time $45 welcome credit.',
  pricePerMonthCents: 19_900,
  includedCreditsDecimillicents: 0,
  stripePriceIdEnvKey: 'STRIPE_AGENCY_PRICE_ID',
  featureLimits: {
    workflowExecutionsPerMonth: null,
    apiCallsPerMonth: null,
    teamMembers: null,
    storageIncludedBytes: 500 * GB,
    storageOverageRateDecimillicentsPerGbMonth: 800_000 // $0.08/GB/month
  }
}

export const subscriptionPlans: Record<SubscriptionPlanSlug, SubscriptionPlanDefinition> = {
  try_me: tryMePlanDefinition,
  pro: proPlanDefinition,
  agency: agencyPlanDefinition
}

export const getSubscriptionPlan = (slug: SubscriptionPlanSlug): SubscriptionPlanDefinition =>
  subscriptionPlans[slug]

/**
 * Indexed constants surfaced for mechanical tests and UI rendering.
 * Mirror {@link subscriptionPlans} but without the wrapper types, so that
 * test assertions and Tailwind-scoped plan cards can reach the raw numbers
 * without calling the getter.
 *
 * @spec billing-and-pricing-design §"Plans"
 * @spec INV-BILLING-NO-BUNDLED-CREDITS
 * @spec INV-BILLING-NO-SEAT-LIMITS
 */
export const PLAN_PRICE_CENTS = {
  try_me: 1900,
  pro: 4900,
  agency: 19_900
} as const satisfies Record<SubscriptionPlanSlug, number>

export const PLAN_STORAGE_LIMIT_BYTES = {
  try_me: 10 * GB,
  pro: 100 * GB,
  agency: 500 * GB
} as const satisfies Record<SubscriptionPlanSlug, number>

/**
 * Hard ceiling in bytes — at this point uploads are rejected with 402 even
 * if the org has positive credit balance. Derived from the plan's included
 * storage × `STORAGE_HARD_CAP_MULTIPLIER` (2) per the spec's 20 GB / 200 GB
 * / 1 TB ceilings.
 */
export const PLAN_HARD_CEILING_BYTES = {
  try_me: 20 * GB,
  pro: 200 * GB,
  agency: 1000 * GB
} as const satisfies Record<SubscriptionPlanSlug, number>
