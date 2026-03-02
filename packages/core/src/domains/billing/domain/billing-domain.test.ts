import { describe, expect, it } from 'vitest'
import {
  canAccessFeature,
  isSubscriptionActive,
  isSubscriptionGuardSatisfied,
  isWithinUsageLimit
} from './billing-domain.js'

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
