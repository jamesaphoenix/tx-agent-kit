'use client'

import { useState } from 'react'
import { subscriptionPlans, type SubscriptionPlanSlug } from '@tx-agent-kit/contracts'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCurrentPrincipal } from '@/hooks/use-session-store'
import { useMyPermissions } from '@/hooks/use-permissions'
import {
  useBillingCreateCheckoutSession,
  useBillingGetBillingSettings
} from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { readBrowserLocationState } from '@/lib/url-state'
import { DashboardShell } from '@/components/DashboardShell'
import { BillingRouteNav } from '@/components/billing/BillingRouteNav'
import { CreditBalanceWidget } from '@/components/billing/CreditBalanceWidget'
import { GracePeriodBanner } from '@/components/billing/GracePeriodBanner'
import { ManagePaymentMethodButton } from '@/components/billing/ManagePaymentMethodButton'
import {
  formatUsdFromCents,
  formatUsdFromDecimillicents,
  navigateToBillingUrl
} from '@/components/billing/billing-utils'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

const planOrder: SubscriptionPlanSlug[] = ['try_me', 'pro', 'agency']

const getCheckoutButtonLabel = (
  planDisplayName: string,
  isCurrent: boolean,
  isPending: boolean
): string => {
  if (isCurrent) {
    return 'Current plan'
  }

  if (isPending) {
    return 'Opening checkout...'
  }

  return `Choose ${planDisplayName}`
}

export const resolveCheckoutSuccessPath = (
  orgId: string,
  currentSubscriptionPlan: string | null | undefined
): string => {
  return currentSubscriptionPlan === null
    ? `/org/${orgId}/onboarding/welcome`
    : `/org/${orgId}/billing`
}

export default function BillingPlansPage() {
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const principal = useCurrentPrincipal()
  const permissionsQuery = useMyPermissions()
  const billingQuery = useBillingGetBillingSettings(orgId, {
    query: {}
  })

  const canManageBilling = permissionsQuery.data?.permissions.includes('manage_billing') ?? false
  const billing = billingQuery.data ?? null
  const [pendingPlan, setPendingPlan] = useState<SubscriptionPlanSlug | null>(null)

  const checkoutMutation = useBillingCreateCheckoutSession({
    mutation: {
      onError: () => {
        notify.error('Failed to open Stripe checkout')
      }
    }
  })

  const launchCheckout = async (subscriptionPlan: SubscriptionPlanSlug) => {
    try {
      const origin = readBrowserLocationState().origin
      const successPath = resolveCheckoutSuccessPath(orgId, billing?.subscriptionPlan)
      const session = await checkoutMutation.mutateAsync({
        data: {
          organizationId: orgId,
          subscriptionPlan,
          successUrl: `${origin}${successPath}`,
          cancelUrl: `${origin}/org/${orgId}/billing/plans`
        }
      })
      navigateToBillingUrl(session.url)
    } catch {
      // handled by mutation callback
    }
  }

  return (
    <DashboardShell
      title="Billing plans"
      subtitle="Compare tx-agent-kit subscription tiers and choose the right credit envelope."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      {permissionsQuery.isLoading || billingQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : null}

      {!permissionsQuery.isLoading && !canManageBilling ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Billing access required</CardTitle>
            <CardDescription>
              Only organization admins can compare plans and open Stripe checkout.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canManageBilling && billing ? (
        <div className="flex flex-col gap-6">
          <BillingRouteNav organizationId={orgId} />
          <GracePeriodBanner organizationId={orgId} />
          <CreditBalanceWidget organizationId={orgId} />

          <div className="grid gap-6 xl:grid-cols-3">
            {planOrder.map((slug) => {
              const plan = subscriptionPlans[slug]
              const isCurrent = billing.subscriptionPlan === slug

              return (
                <Card key={slug} className="shadow-sm">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle>{plan.displayName}</CardTitle>
                      {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                    </div>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-muted-foreground">Monthly price</span>
                      <span className="text-2xl font-semibold">
                        ${((plan.pricePerMonthCents ?? 0) / 100).toFixed(0)}
                        <span className="text-sm font-normal text-muted-foreground"> / month</span>
                      </span>
                    </div>

                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Included credits</span>
                        <span>{formatUsdFromDecimillicents(plan.includedCreditsDecimillicents)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Storage included</span>
                        <span>{Math.round(plan.featureLimits.storageIncludedBytes / (1024 * 1024 * 1024))} GB</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Storage overage</span>
                        <span>
                          {formatUsdFromDecimillicents(
                            plan.featureLimits.storageOverageRateDecimillicentsPerGbMonth
                          )}
                          /GB-month
                        </span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-3 items-stretch">
                    <Button
                      type="button"
                      onClick={() => setPendingPlan(slug)}
                      disabled={isCurrent || checkoutMutation.isPending}
                    >
                      {getCheckoutButtonLabel(plan.displayName, isCurrent, checkoutMutation.isPending)}
                    </Button>
                    {isCurrent ? (
                      <ManagePaymentMethodButton
                        organizationId={orgId}
                        stripeCustomerId={billing.stripeCustomerId}
                        variant="outline"
                      />
                    ) : null}
                  </CardFooter>
                </Card>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={`/org/${orgId}/billing`} className={buttonVariants({ variant: 'outline' })}>
              Back to overview
            </Link>
            <Link href={`/org/${orgId}/billing/settings`} className={buttonVariants({ variant: 'secondary' })}>
              Billing settings
            </Link>
          </div>

          <Dialog
            open={pendingPlan !== null}
            onOpenChange={(open) => {
              if (!open) {
                setPendingPlan(null)
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm plan change</DialogTitle>
                <DialogDescription>
                  {pendingPlan
                    ? `Open Stripe checkout for the ${subscriptionPlans[pendingPlan].displayName} plan at ${formatUsdFromCents(subscriptionPlans[pendingPlan].pricePerMonthCents)} per month.`
                    : 'Review the selected billing plan before continuing to Stripe.'}
                </DialogDescription>
              </DialogHeader>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingPlan(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (!pendingPlan) {
                      return
                    }
                    void launchCheckout(pendingPlan)
                  }}
                  disabled={checkoutMutation.isPending || pendingPlan === null}
                >
                  {checkoutMutation.isPending ? 'Opening checkout...' : 'Confirm plan change'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </DashboardShell>
  )
}
