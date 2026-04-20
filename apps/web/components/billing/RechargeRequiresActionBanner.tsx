'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  useBillingCreatePortalSession,
  useBillingGetBillingSettings
} from '@/lib/api/generated/billing/billing'
import { getApiErrorMessage } from '@/lib/axios'
import { formatDateTime } from '@/lib/billing-format'
import { navigateToExternalUrl, readBrowserLocationState } from '@/lib/url-state'

/**
 * Banner that surfaces the 3DS / SCA + failed-payment recovery flow.
 *
 * Hidden when the org is healthy. When the latest auto-recharge
 * attempt requires the user to complete Strong Customer Authentication
 * (or any other payment failure that starts the grace period), the
 * backend sets `organizations.payment_grace_period_ends_at`, which is
 * surfaced on `useBillingGetBillingSettings` as
 * `paymentGracePeriodEndsAt`. This component renders an amber banner
 * with the grace period deadline and a "Complete verification in Stripe"
 * button that opens the Stripe customer portal via
 * `useBillingCreatePortalSession` — Stripe owns the actual 3DS / retry
 * flow.
 *
 * NOTE: The contract does not currently expose a direct
 * `stripeNextActionUrl` from the underlying `auto_recharge_attempts`
 * row, so we route through the customer portal, which handles both 3DS
 * re-confirmation and card updates. Surfacing the next-action URL
 * directly is tracked for Slice 14's verification pass.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — 3DS challenge
 */
export interface RechargeRequiresActionBannerProps {
  readonly organizationId: string
}

export function RechargeRequiresActionBanner({
  organizationId
}: RechargeRequiresActionBannerProps): React.ReactElement | null {
  const settingsQuery = useBillingGetBillingSettings(organizationId)
  const createPortal = useBillingCreatePortalSession()
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const gracePeriodEndsAt = settingsQuery.data?.paymentGracePeriodEndsAt ?? null
  if (gracePeriodEndsAt === null) {
    return null
  }

  const handleOpenPortal = async (): Promise<void> => {
    setErrorMessage(null)
    const { origin } = readBrowserLocationState()
    try {
      const session = await createPortal.mutateAsync({
        data: {
          organizationId,
          returnUrl: `${origin}/org/${organizationId}/billing`
        }
      })
      if (session.url) {
        navigateToExternalUrl(session.url)
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Could not open Stripe portal.'))
    }
  }

  return (
    <div
      role="alert"
      data-testid="recharge-requires-action-banner"
      className="flex flex-col gap-3 rounded-md border border-amber-400 bg-amber-50 p-4 text-amber-900"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Additional verification required</h2>
        <p className="text-sm">
          Your last auto-recharge could not complete — your bank needs you to
          confirm the charge. Operations stay available until{' '}
          <span data-testid="recharge-requires-action-deadline" className="font-medium">
            {formatDateTime(gracePeriodEndsAt)}
          </span>
          . Complete the verification in Stripe to restore auto-recharge.
        </p>
      </div>
      {errorMessage ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">
          {errorMessage}
        </div>
      ) : null}
      <div>
        <Button
          type="button"
          className="btn"
          disabled={createPortal.isPending}
          onClick={() => {
            void handleOpenPortal()
          }}
          data-testid="recharge-requires-action-cta"
        >
          {createPortal.isPending ? 'Opening…' : 'Complete verification in Stripe'}
        </Button>
      </div>
    </div>
  )
}
