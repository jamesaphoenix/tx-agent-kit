'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentPrincipal } from '@/hooks/use-session-store'
import { useMyPermissions } from '@/hooks/use-permissions'
import {
  getBillingGetBillingSettingsQueryKey,
  useBillingGetCreditHistory,
  useBillingGetBillingSettings,
  useBillingUpdateBillingSettings
} from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { DashboardShell } from '@/components/DashboardShell'
import { AutoRechargeForm } from '@/components/billing/AutoRechargeForm'
import { BillingRouteNav } from '@/components/billing/BillingRouteNav'
import { CreditBalanceWidget } from '@/components/billing/CreditBalanceWidget'
import { GracePeriodBanner } from '@/components/billing/GracePeriodBanner'
import { ManagePaymentMethodButton } from '@/components/billing/ManagePaymentMethodButton'
import { SpendCapForm } from '@/components/billing/SpendCapForm'
import {
  formatBillingDateTime,
  formatUsdFromDecimillicents
} from '@/components/billing/billing-utils'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function BillingSettingsPage() {
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const principal = useCurrentPrincipal()
  const permissionsQuery = useMyPermissions()
  const queryClient = useQueryClient()
  const billingQuery = useBillingGetBillingSettings(orgId, {
    query: {}
  })
  const [billingEmail, setBillingEmail] = useState('')
  const seededOrgIdRef = useRef<string | null>(null)

  useEffect(() => {
    const billing = billingQuery.data
    if (!billing || seededOrgIdRef.current === billing.organizationId) {
      return
    }

    setBillingEmail(billing.billingEmail ?? principal?.email ?? '')
    seededOrgIdRef.current = billing.organizationId
  }, [billingQuery.data, principal?.email])

  const canManageBilling = permissionsQuery.data?.permissions.includes('manage_billing') ?? false
  const historyQuery = useBillingGetCreditHistory(
    orgId,
    { limit: '10' },
    {
      query: {
        enabled: canManageBilling
      }
    }
  )

  const updateMutation = useBillingUpdateBillingSettings({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getBillingGetBillingSettingsQueryKey(orgId)
        })
        notify.success('Billing contact saved')
      },
      onError: () => {
        notify.error('Failed to save billing contact')
      }
    }
  })

  const saveBillingEmail = async () => {
    try {
      await updateMutation.mutateAsync({
        organizationId: orgId,
        data: { billingEmail }
      })
    } catch {
      // handled in mutation callback
    }
  }

  const billing = billingQuery.data ?? null
  const welcomeCreditEntries = (historyQuery.data?.items ?? []).filter((entry) =>
    /welcome credit/i.test(entry.reason)
    || entry.referenceId === 'welcome-credit'
  )

  return (
    <DashboardShell
      title="Billing settings"
      subtitle="Control billing email, payment methods, auto-recharge, and monthly spend limits."
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
              Only organization admins can edit billing settings and payment methods.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canManageBilling && billing ? (
        <div className="flex flex-col gap-6">
          <BillingRouteNav organizationId={orgId} />
          <GracePeriodBanner organizationId={orgId} />
          <CreditBalanceWidget organizationId={orgId} />

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Billing contact</CardTitle>
              <CardDescription>
                Receipts, plan changes, and payment notices go to this address.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="billing-email">Billing email</Label>
              <Input
                id="billing-email"
                type="email"
                value={billingEmail}
                onChange={(event) => setBillingEmail(event.target.value)}
              />
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Welcome credit and ledger events are available on the history page.
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/org/${orgId}/billing/history`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  View history
                </Link>
                <Button
                  type="button"
                  onClick={() => { void saveBillingEmail() }}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save billing contact'}
                </Button>
              </div>
            </CardFooter>
          </Card>

          <AutoRechargeForm organizationId={orgId} settings={billing} />
          <SpendCapForm organizationId={orgId} settings={billing} />

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Welcome credit history</CardTitle>
              <CardDescription>
                One-time onboarding credits granted to this organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {welcomeCreditEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No welcome credit grants are visible in the recent ledger window.
                </p>
              ) : (
                welcomeCreditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-1 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="grid gap-1">
                      <span className="font-medium">{entry.reason}</span>
                      <span className="text-sm text-muted-foreground">
                        {formatBillingDateTime(entry.createdAt)}
                      </span>
                    </div>
                    <span className="font-medium text-emerald-700">
                      {formatUsdFromDecimillicents(entry.amountDecimillicents)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
            <CardFooter className="justify-end">
              <Link
                href={`/org/${orgId}/billing/history`}
                className={buttonVariants({ variant: 'outline' })}
              >
                View full history
              </Link>
            </CardFooter>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Payment method</CardTitle>
              <CardDescription>
                Open the Stripe customer portal to update the saved card or billing details.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                {billing.stripeCustomerId
                  ? 'Stripe customer profile configured.'
                  : 'Stripe customer profile is not configured yet. Complete checkout or a top-up first.'}
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/org/${orgId}/billing`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Back to overview
                </Link>
                <ManagePaymentMethodButton
                  organizationId={orgId}
                  stripeCustomerId={billing.stripeCustomerId}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </DashboardShell>
  )
}
