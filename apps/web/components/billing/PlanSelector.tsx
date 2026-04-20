'use client'

import * as React from 'react'
import { subscriptionPlanSlugs, type SubscriptionPlanSlug } from '@tx-agent-kit/contracts'
import {
  useBillingCreateCheckoutSession,
  useBillingGetBillingSettings
} from '@/lib/api/generated/billing/billing'
import { getApiErrorMessage } from '@/lib/axios'
import { navigateToExternalUrl, readBrowserLocationState } from '@/lib/url-state'
import { PlanCard } from './PlanCard'

/**
 * Plan selector page. Reads the org's current subscription plan via
 * `useBillingGetBillingSettings`, renders the three plan cards side by
 * side, and wires the Upgrade CTA to
 * `useBillingCreateCheckoutSession` — which returns a Stripe-hosted
 * checkout session URL the user is redirected to.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — plan selector
 */
export interface PlanSelectorProps {
  readonly organizationId: string
}

const isSubscriptionPlanSlug = (value: string | null): value is SubscriptionPlanSlug =>
  value !== null && (subscriptionPlanSlugs as ReadonlyArray<string>).includes(value)

export function PlanSelector({ organizationId }: PlanSelectorProps): React.ReactElement {
  const settingsQuery = useBillingGetBillingSettings(organizationId, { query: {} })
  const createCheckout = useBillingCreateCheckoutSession()
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const currentPlan: SubscriptionPlanSlug | null = React.useMemo(() => {
    const raw = settingsQuery.data?.subscriptionPlan ?? null
    return isSubscriptionPlanSlug(raw) ? raw : null
  }, [settingsQuery.data?.subscriptionPlan])

  const handleUpgrade = async (plan: SubscriptionPlanSlug): Promise<void> => {
    setErrorMessage(null)
    const { origin } = readBrowserLocationState()
    try {
      const session = await createCheckout.mutateAsync({
        data: {
          organizationId,
          subscriptionPlan: plan,
          successUrl: `${origin}/org/${organizationId}/billing?upgrade=success`,
          cancelUrl: `${origin}/org/${organizationId}/billing/plans?upgrade=cancelled`
        }
      })
      if (session.url) {
        navigateToExternalUrl(session.url)
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Could not start checkout session.'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {errorMessage ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {subscriptionPlanSlugs.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            currentPlan={currentPlan}
            onUpgrade={(selected) => {
              void handleUpgrade(selected)
            }}
            isUpgrading={createCheckout.isPending}
          />
        ))}
      </div>
    </div>
  )
}
