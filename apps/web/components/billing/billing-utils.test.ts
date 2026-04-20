import { describe, expect, it, vi } from 'vitest'
import { navigateToBillingUrl } from './billing-utils'

describe('navigateToBillingUrl', () => {
  it('assigns same-origin URLs so local Stripe stub redirects trigger a real navigation', () => {
    const assign = vi.fn()

    navigateToBillingUrl('/org/org_123/billing?session_id=cs_local', {
      origin: 'http://localhost:3000',
      assign
    })

    expect(assign).toHaveBeenCalledWith('http://localhost:3000/org/org_123/billing?session_id=cs_local')
  })

  it('assigns external Stripe URLs unchanged', () => {
    const assign = vi.fn()

    navigateToBillingUrl('https://checkout.stripe.com/c/pay/cs_test_123', {
      origin: 'http://localhost:3000',
      assign
    })

    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_123')
  })
})
