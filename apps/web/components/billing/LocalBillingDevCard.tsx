'use client'

import type { ComponentProps, ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  WELCOME_CREDIT_DECIMILLICENTS,
  type SubscriptionPlanSlug
} from '@tx-agent-kit/contracts'
import {
  getBillingGetBillingSettingsQueryKey,
  getBillingGetCreditBalanceQueryKey,
  useBillingCompleteLocalBillingSetup
} from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatUsdFromDecimillicents } from './billing-utils'

const localPlanButtons: ReadonlyArray<{
  plan: SubscriptionPlanSlug
  label: string
  variant: ComponentProps<typeof Button>['variant']
}> = [
  {
    plan: 'try_me',
    label: `Activate local Try Me + ${formatUsdFromDecimillicents(WELCOME_CREDIT_DECIMILLICENTS.try_me)} credit`,
    variant: 'outline'
  },
  {
    plan: 'pro',
    label: `Activate local Pro + ${formatUsdFromDecimillicents(WELCOME_CREDIT_DECIMILLICENTS.pro)} credit`,
    variant: 'default'
  },
  {
    plan: 'agency',
    label: `Activate local Agency + ${formatUsdFromDecimillicents(WELCOME_CREDIT_DECIMILLICENTS.agency)} credit`,
    variant: 'outline'
  }
]

export interface LocalBillingDevCardProps {
  readonly organizationId: string
  readonly wasSubscribed: boolean
  readonly onFirstActivation?: () => void
}

export function LocalBillingDevCard({
  organizationId,
  wasSubscribed,
  onFirstActivation
}: LocalBillingDevCardProps): ReactElement {
  const queryClient = useQueryClient()
  const completeLocalBillingMutation = useBillingCompleteLocalBillingSetup({
    mutation: {
      onError: (error) => {
        notify.apiError(error, 'Failed to activate local billing')
      }
    }
  })

  const activateLocalBilling = async (subscriptionPlan: SubscriptionPlanSlug) => {
    await completeLocalBillingMutation.mutateAsync({
      organizationId,
      data: { subscriptionPlan }
    })

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getBillingGetBillingSettingsQueryKey(organizationId)
      }),
      queryClient.invalidateQueries({
        queryKey: getBillingGetCreditBalanceQueryKey(organizationId)
      })
    ])

    notify.success('Local billing activated')

    if (!wasSubscribed) {
      onFirstActivation?.()
    }
  }

  return (
    <Card className="border-dashed shadow-sm">
      <CardHeader>
        <CardTitle>Local billing tools</CardTitle>
        <CardDescription>
          Development/test only. Skip Stripe checkout, activate a subscription immediately, and grant the
          matching one-time welcome credit once for this organization.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {localPlanButtons.map((button) => (
            <Button
              key={button.plan}
              type="button"
              variant={button.variant}
              disabled={completeLocalBillingMutation.isPending}
              onClick={() => { void activateLocalBilling(button.plan) }}
            >
              {completeLocalBillingMutation.isPending
                ? 'Activating local billing...'
                : button.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
