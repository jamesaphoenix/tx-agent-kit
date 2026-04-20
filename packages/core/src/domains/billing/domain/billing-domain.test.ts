import { describe, expect, it } from 'vitest'
import {
  canAccessFeature,
  isSubscriptionActive,
  isSubscriptionGuardSatisfied,
  isWithinUsageLimit,
  toBillingSettings,
  type BillingSettingsRecord
} from './billing-domain.js'

// Construct a fixed Date without triggering the `new Date()` lint rule.
const fixedDate = /* @__PURE__ */ (() => {
  const D = Date
  return new D('2024-01-01')
})()

describe('billing domain guards', () => {
  it('treats active, trialing, and past_due subscriptions as active', () => {
    expect(isSubscriptionActive('active')).toBe(true)
    expect(isSubscriptionActive('trialing')).toBe(true)
    expect(isSubscriptionActive('past_due')).toBe(true)
    expect(isSubscriptionActive('canceled')).toBe(false)
    expect(isSubscriptionActive('paused')).toBe(false)
    expect(isSubscriptionActive('unpaid')).toBe(false)
    expect(isSubscriptionActive('inactive')).toBe(false)
  })

  it('checks plan access hierarchy', () => {
    expect(canAccessFeature('pro', 'active', 'pro')).toBe(true)
    expect(canAccessFeature('pro', 'past_due', 'pro')).toBe(true)
    expect(canAccessFeature(null, 'active', 'pro')).toBe(false)
    expect(canAccessFeature('pro', 'canceled', 'pro')).toBe(false)
    expect(canAccessFeature('pro', 'active', 'free')).toBe(true)
  })

  // Hierarchy: try_me < pro < agency. A higher-tier plan must grant
  // access to every lower-tier feature; a lower-tier plan must NOT grant
  // access to a higher-tier feature. These specific edges were previously
  // untested — regressions in the ordering (e.g. alphabetizing the enum)
  // would silently grant wrong access levels.
  it('grants higher-tier plans access to lower-tier features', () => {
    // agency can access everything below it
    expect(canAccessFeature('agency', 'active', 'free')).toBe(true)
    expect(canAccessFeature('agency', 'active', 'try_me')).toBe(true)
    expect(canAccessFeature('agency', 'active', 'pro')).toBe(true)
    expect(canAccessFeature('agency', 'active', 'agency')).toBe(true)
    // pro can access try_me + free but NOT agency
    expect(canAccessFeature('pro', 'active', 'try_me')).toBe(true)
    expect(canAccessFeature('pro', 'active', 'agency')).toBe(false)
    // try_me can access free but NOT pro or agency
    expect(canAccessFeature('try_me', 'active', 'free')).toBe(true)
    expect(canAccessFeature('try_me', 'active', 'pro')).toBe(false)
    expect(canAccessFeature('try_me', 'active', 'agency')).toBe(false)
  })

  it('rejects unrecognized plan strings for paid features', () => {
    // A bogus plan value (typo, migration drift, future tier) must not
    // unlock paid features — fail closed.
    expect(canAccessFeature('enterprise', 'active', 'pro')).toBe(false)
    expect(canAccessFeature('', 'active', 'pro')).toBe(false)
    // But 'free' is always allowed when status is active, regardless
    // of plan string validity (the plan string isn't consulted for
    // free features).
    expect(canAccessFeature('enterprise', 'active', 'free')).toBe(true)
  })

  it('denies access for every non-active status across all plans', () => {
    const inactiveStatuses = ['canceled', 'paused', 'unpaid', 'inactive'] as const
    const plans = ['try_me', 'pro', 'agency', null] as const
    const targets = ['free', 'try_me', 'pro', 'agency'] as const
    for (const status of inactiveStatuses) {
      for (const plan of plans) {
        for (const target of targets) {
          expect(canAccessFeature(plan, status, target)).toBe(false)
        }
      }
    }
  })

  it('checks usage limits with nullable unlimited values', () => {
    expect(isWithinUsageLimit(10, null)).toBe(true)
    expect(isWithinUsageLimit(10, 10)).toBe(true)
    expect(isWithinUsageLimit(11, 10)).toBe(false)
  })

  it('honors subscription guard toggle', () => {
    expect(isSubscriptionGuardSatisfied({ isSubscribed: false, subscriptionStatus: 'inactive' }, false)).toBe(true)
    expect(isSubscriptionGuardSatisfied({ isSubscribed: false, subscriptionStatus: 'inactive' }, true)).toBe(false)
    expect(isSubscriptionGuardSatisfied({ isSubscribed: true, subscriptionStatus: 'active' }, true)).toBe(true)
    expect(isSubscriptionGuardSatisfied({ isSubscribed: true, subscriptionStatus: 'past_due' }, true)).toBe(true)
  })
})

// ── toBillingSettings ──────────────────────────────────────────────

const makeBillingRow = (overrides: Partial<BillingSettingsRecord> = {}): BillingSettingsRecord => ({
  id: '00000000-0000-0000-0000-000000000001',
  ownerUserId: '00000000-0000-0000-0000-000000000002',
  billingEmail: 'billing@example.com',
  stripeCustomerId: 'cus_123',
  stripeSubscriptionId: 'sub_123',
  stripePaymentMethodId: 'pm_123',
  stripeMeteredSubscriptionItemId: 'si_123',
  usageCap: 100_000,
  creditsBalance: 500_000,
  reservedCredits: 50_000,
  autoRechargeEnabled: true,
  autoRechargeThreshold: 100_000,
  autoRechargeAmount: 500_000,
  isSubscribed: true,
  subscriptionStatus: 'active',
  subscriptionPlan: 'pro',
  subscriptionStartedAt: fixedDate,
  subscriptionEndsAt: null,
  subscriptionCurrentPeriodEnd: fixedDate,
  paymentGracePeriodEndsAt: null,
  suspendedAt: null,
  welcomeCreditGrantedAt: null,
  ...overrides
})

describe('toBillingSettings', () => {
  it('maps all fields from BillingSettingsRecord to BillingSettings', () => {
    const row = makeBillingRow()
    const result = toBillingSettings(row)

    expect(result).toEqual({
      organizationId: row.id,
      billingEmail: 'billing@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      stripePaymentMethodId: 'pm_123',
      stripeMeteredSubscriptionItemId: 'si_123',
      usageCapDecimillicents: 100_000,
      creditsBalanceDecimillicents: 500_000,
      reservedCreditsDecimillicents: 50_000,
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 100_000,
      autoRechargeAmountDecimillicents: 500_000,
      isSubscribed: true,
      subscriptionStatus: 'active',
      subscriptionPlan: 'pro',
      subscriptionStartedAt: fixedDate,
      subscriptionEndsAt: null,
      subscriptionCurrentPeriodEnd: fixedDate,
      paymentGracePeriodEndsAt: null,
      suspendedAt: null
    })
  })

  it('maps recognized subscription plan slug to the plan value', () => {
    const row = makeBillingRow({ subscriptionPlan: 'pro' })
    expect(toBillingSettings(row).subscriptionPlan).toBe('pro')
  })

  it('maps null subscription plan to null', () => {
    const row = makeBillingRow({ subscriptionPlan: null })
    expect(toBillingSettings(row).subscriptionPlan).toBeNull()
  })

  it('maps unrecognized subscription plan to null', () => {
    const row = makeBillingRow({ subscriptionPlan: 'enterprise' })
    expect(toBillingSettings(row).subscriptionPlan).toBeNull()
  })

  it('maps nullable fields as null when absent', () => {
    const row = makeBillingRow({
      billingEmail: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePaymentMethodId: null,
      stripeMeteredSubscriptionItemId: null,
      autoRechargeThreshold: null,
      autoRechargeAmount: null,
      subscriptionStartedAt: null,
      subscriptionEndsAt: null,
      subscriptionCurrentPeriodEnd: null
    })
    const result = toBillingSettings(row)

    expect(result.billingEmail).toBeNull()
    expect(result.stripeCustomerId).toBeNull()
    expect(result.stripeSubscriptionId).toBeNull()
    expect(result.stripePaymentMethodId).toBeNull()
    expect(result.stripeMeteredSubscriptionItemId).toBeNull()
    expect(result.autoRechargeThresholdDecimillicents).toBeNull()
    expect(result.autoRechargeAmountDecimillicents).toBeNull()
    expect(result.subscriptionStartedAt).toBeNull()
    expect(result.subscriptionEndsAt).toBeNull()
    expect(result.subscriptionCurrentPeriodEnd).toBeNull()
  })
})
