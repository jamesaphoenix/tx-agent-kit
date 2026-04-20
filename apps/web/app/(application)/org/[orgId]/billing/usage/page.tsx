'use client'

import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { usageCategories, type UsageCategory } from '@tx-agent-kit/contracts'
import { useParams } from 'next/navigation'
import { useCurrentPrincipal, useIsSessionReady } from '@/hooks/use-session-store'
import { useMyPermissions } from '@/hooks/use-permissions'
import {
  getBillingGetUsageSummaryQueryOptions,
  useBillingGetBillingSettings
} from '@/lib/api/generated/billing/billing'
import { DashboardShell } from '@/components/DashboardShell'
import { BillingUsageSkeleton } from '@/components/billing/BillingUsageSkeleton'
import { BillingRouteNav } from '@/components/billing/BillingRouteNav'
import { GracePeriodBanner } from '@/components/billing/GracePeriodBanner'
import { formatUsdFromDecimillicents } from '@/components/billing/billing-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

const periodOptions = [7, 30, 90] as const

const preservePreviousData = <T,>(previousData: T | undefined) => previousData

const categoryLabels: Record<UsageCategory, string> = {
  api_call: 'API calls',
  image_generation: 'Image generation',
  openrouter_inference: 'OpenRouter inference',
  storage: 'Storage',
  text_generation: 'Text generation',
  video_generation: 'Video generation',
  workflow_execution: 'Workflow execution'
}

const buildIsoRange = (days: number) => {
  const end = new Date()
  const start = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000))
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  }
}

const buildCurrentMonthRange = () => {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), 1)
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  }
}

export default function BillingUsagePage() {
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const principal = useCurrentPrincipal()
  const isSessionReady = useIsSessionReady()
  const permissionsQuery = useMyPermissions()
  const billingQuery = useBillingGetBillingSettings(orgId, {
    query: {}
  })
  const [periodDays, setPeriodDays] = useState<typeof periodOptions[number]>(30)

  const canManageBilling = permissionsQuery.data?.permissions.includes('manage_billing') ?? false
  const currentRange = useMemo(() => buildIsoRange(periodDays), [periodDays])
  const currentMonthRange = useMemo(() => buildCurrentMonthRange(), [])
  const trendRanges = useMemo(
    () => [0, 1, 2].map((offset) => {
      const end = new Date(Date.now() - (offset * 30 * 24 * 60 * 60 * 1000))
      const start = new Date(end.getTime() - (30 * 24 * 60 * 60 * 1000))
      return {
        label: offset === 0 ? 'Current 30d' : `${offset + 1} periods ago`,
        startIso: start.toISOString(),
        endIso: end.toISOString()
      }
    }),
    []
  )

  const categoryQueries = useQueries({
    queries: usageCategories.map((category) =>
      getBillingGetUsageSummaryQueryOptions(
        orgId,
        {
          category,
          periodStart: currentRange.startIso,
          periodEnd: currentRange.endIso
        },
        {
          query: {
            enabled: canManageBilling,
            placeholderData: preservePreviousData
          }
        }
      )
    )
  })

  const trendQueries = useQueries({
    queries: trendRanges.flatMap((range) =>
      usageCategories.map((category) =>
        getBillingGetUsageSummaryQueryOptions(
          orgId,
          {
            category,
            periodStart: range.startIso,
            periodEnd: range.endIso
          },
          {
            query: {
              enabled: canManageBilling,
              placeholderData: preservePreviousData
            }
          }
        )
      )
    )
  })

  const monthlyCapQueries = useQueries({
    queries: usageCategories.map((category) =>
      getBillingGetUsageSummaryQueryOptions(
        orgId,
        {
          category,
          periodStart: currentMonthRange.startIso,
          periodEnd: currentMonthRange.endIso
        },
        {
          query: {
            enabled: canManageBilling,
            placeholderData: preservePreviousData
          }
        }
      )
    )
  })

  const summaries = usageCategories.map((category, index) => ({
    category,
    data: categoryQueries[index]?.data
  }))

  const totalCost = summaries.reduce(
    (sum, summary) => sum + (summary.data?.totalCostDecimillicents ?? 0),
    0
  )

  const trendTotals = trendRanges.map((range, rangeIndex) => ({
    label: range.label,
    totalCostDecimillicents: usageCategories.reduce((sum, _, categoryIndex) => {
      const queryIndex = (rangeIndex * usageCategories.length) + categoryIndex
      return sum + (trendQueries[queryIndex]?.data?.totalCostDecimillicents ?? 0)
    }, 0)
  }))

  const usageCap = billingQuery.data?.usageCapDecimillicents ?? null
  const currentMonthCost = usageCategories.reduce(
    (sum, _, index) => sum + (monthlyCapQueries[index]?.data?.totalCostDecimillicents ?? 0),
    0
  )
  const usageCapProgress = usageCap === null || usageCap === 0
    ? null
    : Math.min(100, (currentMonthCost / usageCap) * 100)

  const usageQueries = [...categoryQueries, ...trendQueries, ...monthlyCapQueries]
  const isInitialLoading = permissionsQuery.isLoading
    || !isSessionReady
    || (canManageBilling && billingQuery.isLoading)
  const isRefreshing = canManageBilling
    && !isInitialLoading
    && (
      billingQuery.isFetching
      || usageQueries.some((query) => query.isFetching)
    )
  const showAccessGuard = isSessionReady && !permissionsQuery.isLoading && !canManageBilling

  return (
    <DashboardShell
      title="Billing usage"
      subtitle="Track cost by billing category and compare spend against the optional cap."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      {showAccessGuard ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Billing access required</CardTitle>
            <CardDescription>
              Only organization admins can inspect usage-cost summaries.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!showAccessGuard && isInitialLoading ? <BillingUsageSkeleton /> : null}

      {canManageBilling && !isInitialLoading ? (
        <div className="flex flex-col gap-6">
          <BillingRouteNav organizationId={orgId} />
          <GracePeriodBanner organizationId={orgId} />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {periodOptions.map((days) => (
                <Button
                  key={days}
                  type="button"
                  size="sm"
                  variant={periodDays === days ? 'default' : 'outline'}
                  onClick={() => setPeriodDays(days)}
                >
                  Last {days} days
                </Button>
              ))}
            </div>
            {isRefreshing ? (
              <span className="text-sm text-muted-foreground">Updating usage…</span>
            ) : null}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Total spend</CardTitle>
                <CardDescription>Aggregate usage cost for the selected window.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{formatUsdFromDecimillicents(totalCost)}</div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Monthly cap</CardTitle>
                <CardDescription>Optional user-defined guardrail.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="text-3xl font-semibold">
                  {usageCap === null ? 'No cap' : formatUsdFromDecimillicents(usageCap)}
                </div>
                {usageCapProgress !== null ? (
                  <>
                    <Progress value={usageCapProgress} />
                    <p className="text-sm text-muted-foreground">
                      {usageCapProgress.toFixed(0)}% of the cap consumed this month.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Set a cap in billing settings if you want a hard stop on spend.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Recent trend</CardTitle>
                <CardDescription>Rolling 30-day spend snapshots.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {trendTotals.map((trend) => (
                  <div key={trend.label} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{trend.label}</span>
                    <Badge variant="outline">{formatUsdFromDecimillicents(trend.totalCostDecimillicents)}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Category breakdown</CardTitle>
              <CardDescription>
                Cost and volume summaries from immutable usage records.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {summaries.map((summary) => {
                const totalCostDecimillicents = summary.data?.totalCostDecimillicents ?? 0
                const percentage = totalCost === 0 ? 0 : (totalCostDecimillicents / totalCost) * 100

                return (
                  <div key={summary.category} className="grid gap-2 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{categoryLabels[summary.category]}</p>
                        <p className="text-sm text-muted-foreground">
                          Quantity: {summary.data?.totalQuantity ?? 0}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        {formatUsdFromDecimillicents(totalCostDecimillicents)}
                      </Badge>
                    </div>
                    <Progress value={percentage} />
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </DashboardShell>
  )
}
