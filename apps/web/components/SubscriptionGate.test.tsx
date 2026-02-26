// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SubscriptionGate } from './SubscriptionGate'

afterEach(() => {
  cleanup()
})

describe('SubscriptionGate', () => {
  it('renders children for active subscriptions', () => {
    render(
      <SubscriptionGate isSubscribed subscriptionStatus="active" fallback={<span>upgrade</span>}>
        <span>protected-content</span>
      </SubscriptionGate>
    )

    expect(screen.queryByText('protected-content')).not.toBeNull()
    expect(screen.queryByText('upgrade')).toBeNull()
  })

  it('renders fallback for inactive subscriptions', () => {
    render(
      <SubscriptionGate isSubscribed={false} subscriptionStatus="inactive" fallback={<span>upgrade</span>}>
        <span>protected-content</span>
      </SubscriptionGate>
    )

    expect(screen.queryByText('protected-content')).toBeNull()
    expect(screen.queryByText('upgrade')).not.toBeNull()
  })

  it('renders fallback for non-active statuses', () => {
    render(
      <SubscriptionGate isSubscribed subscriptionStatus="past_due" fallback={<span>upgrade</span>}>
        <span>protected-content</span>
      </SubscriptionGate>
    )

    expect(screen.queryByText('protected-content')).toBeNull()
    expect(screen.queryByText('upgrade')).not.toBeNull()
  })
})
