'use client'

import { useBillingCreatePortalSession } from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { readBrowserLocationState, resolveBrowserUrl } from '@/lib/url-state'
import { Button } from '@/components/ui/button'
import { navigateToBillingUrl } from './billing-utils'

export interface ManagePaymentMethodButtonProps {
  readonly organizationId: string
  readonly stripeCustomerId?: string | null
  readonly returnUrl?: string
  readonly returnPath?: string
  readonly disabled?: boolean
  readonly variant?: React.ComponentProps<typeof Button>['variant']
  readonly label?: string
}

export function ManagePaymentMethodButton({
  organizationId,
  stripeCustomerId,
  returnUrl,
  returnPath,
  disabled = false,
  variant = 'secondary',
  label = 'Manage payment method'
}: ManagePaymentMethodButtonProps): React.ReactElement {
  const isLocalDevelopmentCustomer = stripeCustomerId?.startsWith('cus_local_') ?? false
  const portalMutation = useBillingCreatePortalSession({
    mutation: {
      onError: (error) => {
        notify.apiError(error, 'Failed to open the payment method portal')
      }
    }
  })

  const openPortal = async () => {
    try {
      if (isLocalDevelopmentCustomer) {
        notify.info(
          'This organization uses local development billing, so there is no real Stripe portal yet. Use Stripe test checkout to create a real Stripe customer first.'
        )
        return
      }

      const currentLocation = readBrowserLocationState()
      const fallbackReturnUrl = returnPath
        ? `${currentLocation.origin}${returnPath}`
        : `${currentLocation.origin}${currentLocation.pathname}`
      const session = await portalMutation.mutateAsync({
        data: {
          organizationId,
          returnUrl: returnUrl ?? fallbackReturnUrl
        }
      })
      const target = resolveBrowserUrl(session.url)
      const currentHref = `${currentLocation.origin}${currentLocation.pathname}${currentLocation.search}`
      if (target.href === currentHref) {
        notify.info('Stripe portal is using the local stub because the API server is not configured with a Stripe secret key.')
        return
      }
      navigateToBillingUrl(session.url)
    } catch {
      // handled by mutation callback
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      onClick={() => { void openPortal() }}
      disabled={disabled || !stripeCustomerId || portalMutation.isPending}
    >
      {portalMutation.isPending ? 'Opening portal...' : label}
    </Button>
  )
}
