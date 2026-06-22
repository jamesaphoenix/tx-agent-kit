// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notify } from '@/lib/notify'
import { readBrowserLocationState } from '@/lib/url-state'
import { ManagePaymentMethodButton } from './ManagePaymentMethodButton'

const mocks = vi.hoisted(() => ({
  useBillingCreatePortalSession: vi.fn(),
  notifyApiError: vi.fn(),
  notifyInfo: vi.fn()
}))

vi.mock('@/lib/api/generated/billing/billing', () => ({
  useBillingCreatePortalSession: mocks.useBillingCreatePortalSession
}))

vi.mock('@/lib/notify', () => ({
  notify: {
    apiError: mocks.notifyApiError,
    info: mocks.notifyInfo
  }
}))

const setPortalMutation = (mutateAsync = vi.fn()) => {
  mocks.useBillingCreatePortalSession.mockReturnValue({
    mutateAsync,
    isPending: false
  })
  return mutateAsync
}

describe('ManagePaymentMethodButton', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('explains local development billing customers instead of making a no-op portal request', async () => {
    const mutateAsync = setPortalMutation()
    const user = userEvent.setup()

    render(
      <ManagePaymentMethodButton
        organizationId="org_123"
        stripeCustomerId="cus_local_org_123"
      />
    )

    await user.click(screen.getByRole('button', { name: /manage payment method/i }))

    expect(mutateAsync).not.toHaveBeenCalled()
    expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('local development billing'))
  })

  it('explains the local portal stub when the API returns the current page', async () => {
    const currentLocation = readBrowserLocationState()
    const currentHref = `${currentLocation.origin}${currentLocation.pathname}${currentLocation.search}`
    const mutateAsync = setPortalMutation(vi.fn().mockResolvedValue({
      id: 'bps_local_123',
      url: currentHref
    }))
    const user = userEvent.setup()

    render(
      <ManagePaymentMethodButton
        organizationId="org_123"
        stripeCustomerId="cus_real_123"
      />
    )

    await user.click(screen.getByRole('button', { name: /manage payment method/i }))

    expect(mutateAsync).toHaveBeenCalledWith({
      data: {
        organizationId: 'org_123',
        returnUrl: `${currentLocation.origin}${currentLocation.pathname}`
      }
    })
    expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('local stub'))
  })
})
