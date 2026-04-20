'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCurrentPrincipal } from '@/hooks/use-session-store'
import { useMyPermissions } from '@/hooks/use-permissions'
import {
  useBillingGetAutoRechargeRequiresAction,
  useBillingGetBillingSettings
} from '@/lib/api/generated/billing/billing'
import { getWebEnv } from '@/lib/env'
import { DashboardShell } from '@/components/DashboardShell'
import { BillingRouteNav } from '@/components/billing/BillingRouteNav'
import { CreditBalanceWidget } from '@/components/billing/CreditBalanceWidget'
import { GracePeriodBanner } from '@/components/billing/GracePeriodBanner'
import { LocalBillingDevCard } from '@/components/billing/LocalBillingDevCard'
import { ManagePaymentMethodButton } from '@/components/billing/ManagePaymentMethodButton'
import { NoCapReminderCard } from '@/components/billing/NoCapReminderCard'
import { ThreeDSChallengeModal } from '@/components/billing/ThreeDSChallengeModal'
import { TopUpDialog } from '@/components/billing/TopUpDialog'
import {
  formatBillingDateTime,
  formatUsdFromDecimillicents
} from '@/components/billing/billing-utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function BillingOverviewPage() {
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const router = useRouter()
  const principal = useCurrentPrincipal()
  const permissionsQuery = useMyPermissions()
  const canManageBilling = permissionsQuery.data?.permissions.includes('manage_billing') ?? false
  const billingQuery = useBillingGetBillingSettings(orgId, {
    query: {}
  })
  const requiresActionQuery = useBillingGetAutoRechargeRequiresAction(orgId, {
    query: {
      enabled: canManageBilling
    }
  })

  const billing = billingQuery.data ?? null
  const webEnv = getWebEnv()
  const stripePublishableKey = webEnv.STRIPE_PUBLISHABLE_KEY
  const showLocalBillingTools = webEnv.NODE_ENV !== 'production' && webEnv.NODE_ENV !== 'staging'
  const [threeDSModalOpen, setThreeDSModalOpen] = useState(false)
  const [latestOpenedThreeDSAttemptId, setLatestOpenedThreeDSAttemptId] = useState<string | null>(null)

  useEffect(() => {
    const attemptId = requiresActionQuery.data?.attemptId ?? null
    if (attemptId && attemptId !== latestOpenedThreeDSAttemptId) {
      setLatestOpenedThreeDSAttemptId(attemptId)
      setThreeDSModalOpen(true)
    }
  }, [latestOpenedThreeDSAttemptId, requiresActionQuery.data?.attemptId])

  return (
    <DashboardShell
      title="Billing"
      subtitle="Manage credits, plans, payment methods, and cost controls from one place."
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
              Only organization admins can manage billing, credits, and payment methods.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canManageBilling && billing ? (
        <div className="flex flex-col gap-6">
          <BillingRouteNav organizationId={orgId} />
          <GracePeriodBanner organizationId={orgId} />
          <CreditBalanceWidget organizationId={orgId} />
          <NoCapReminderCard organizationId={orgId} />
          {showLocalBillingTools ? (
            <LocalBillingDevCard
              organizationId={orgId}
              wasSubscribed={billing.isSubscribed}
              onFirstActivation={() => router.push(`/org/${orgId}/onboarding/welcome`)}
            />
          ) : null}
          {requiresActionQuery.data && !threeDSModalOpen ? (
            <Card className="border-amber-300 shadow-sm">
              <CardHeader>
                <CardTitle>Bank authentication required</CardTitle>
                <CardDescription>
                  Auto-recharge for {formatUsdFromDecimillicents(requiresActionQuery.data.amountDecimillicents)} is waiting for a 3DS challenge.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  onClick={() => setThreeDSModalOpen(true)}
                >
                  Resume authentication
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Quick actions</CardTitle>
                <CardDescription>
                  Add credits, review usage, or move straight into plan management.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <TopUpDialog organizationId={orgId} />
                  <Link
                    href={`/org/${orgId}/billing/plans`}
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    Change plan
                  </Link>
                  <ManagePaymentMethodButton
                    organizationId={orgId}
                    stripeCustomerId={billing.stripeCustomerId}
                    returnPath={`/org/${orgId}/billing`}
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/org/${orgId}/billing/history`}
                    className={buttonVariants({ variant: 'secondary' })}
                  >
                    View credit history
                  </Link>
                  <Link
                    href={`/org/${orgId}/billing/usage`}
                    className={buttonVariants({ variant: 'secondary' })}
                  >
                    Review usage
                  </Link>
                  <Link
                    href={`/org/${orgId}/billing/settings`}
                    className={buttonVariants({ variant: 'secondary' })}
                  >
                    Billing settings
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Current billing state</CardTitle>
                <CardDescription>
                  Snapshot of your subscription, billing contact, and spend controls.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Subscription status</span>
                  <Badge variant="secondary" className="w-fit">
                    {billing.subscriptionStatus}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <Badge variant="outline" className="w-fit">
                    {billing.subscriptionPlan ?? 'No active plan'}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Billing email</span>
                  <span>{billing.billingEmail ?? principal?.email ?? 'Not set'}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">
                    {billing.subscriptionCurrentPeriodEnd ? 'Next charge' : 'Current period end'}
                  </span>
                  <span>{formatBillingDateTime(billing.subscriptionCurrentPeriodEnd)}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Auto-recharge</span>
                  <span>
                    {billing.autoRechargeEnabled
                      ? `${formatUsdFromDecimillicents(billing.autoRechargeAmountDecimillicents)} when balance drops below ${formatUsdFromDecimillicents(billing.autoRechargeThresholdDecimillicents)}`
                      : 'Disabled'}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Monthly spend cap</span>
                  <span>
                    {billing.usageCapDecimillicents === null
                      ? 'No cap'
                      : formatUsdFromDecimillicents(billing.usageCapDecimillicents)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <ThreeDSChallengeModal
            open={threeDSModalOpen}
            clientSecret={requiresActionQuery.data?.clientSecret ?? null}
            stripePublishableKey={stripePublishableKey}
            onOpenChange={setThreeDSModalOpen}
            onSucceeded={() => {
              setThreeDSModalOpen(false)
              void requiresActionQuery.refetch()
            }}
          />
        </div>
      ) : null}
    </DashboardShell>
  )
}
