'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useBillingGetUsageSummary } from '@/lib/api/generated/billing/billing'
import { BillingGetUsageSummaryCategory } from '@/lib/api/generated/schemas/billingGetUsageSummaryCategory'
import { getApiErrorMessage } from '@/lib/axios'
import { formatUsdFromDecimillicents } from '@/lib/billing-format'

/**
 * Usage dashboard card. Queries `useBillingGetUsageSummary` once per
 * billable category and renders a row per category with the period's
 * total cost in USD. A footer row totals the four categories.
 *
 * The period defaults to the last 30 days (the server's default window)
 * and stays pinned to that range — the spec's explicit "current billing
 * period" UI lands alongside the spend cap work in Slice 11.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — usage dashboard
 */
export interface UsageBreakdownCardProps {
  readonly organizationId: string
}

export function UsageBreakdownCard({
  organizationId
}: UsageBreakdownCardProps): React.ReactElement {
  const textQuery = useBillingGetUsageSummary(organizationId, {
    category: BillingGetUsageSummaryCategory.text_generation
  })
  const imageQuery = useBillingGetUsageSummary(organizationId, {
    category: BillingGetUsageSummaryCategory.image_generation
  })
  const videoQuery = useBillingGetUsageSummary(organizationId, {
    category: BillingGetUsageSummaryCategory.video_generation
  })
  const storageQuery = useBillingGetUsageSummary(organizationId, {
    category: BillingGetUsageSummaryCategory.storage
  })

  const rows: ReadonlyArray<{
    readonly key: string
    readonly label: string
    readonly testId: string
    readonly query: typeof textQuery
  }> = [
    { key: 'text', label: 'AI text generation', testId: 'usage-row-text', query: textQuery },
    { key: 'image', label: 'AI image generation', testId: 'usage-row-image', query: imageQuery },
    { key: 'video', label: 'AI video generation', testId: 'usage-row-video', query: videoQuery },
    { key: 'storage', label: 'Storage', testId: 'usage-row-storage', query: storageQuery }
  ]

  const combinedTotal = rows.reduce(
    (sum, row) => sum + (row.query.data?.totalCostDecimillicents ?? 0),
    0
  )

  const renderCell = (query: typeof textQuery): React.ReactNode => {
    if (query.isError) {
      return (
        <span className="text-xs text-red-600">
          {getApiErrorMessage(query.error, 'Could not load usage summary.')}
        </span>
      )
    }
    if (query.isPending) {
      return <span className="text-xs text-muted-foreground">Loading…</span>
    }
    return (
      <span className="text-sm font-medium">
        {formatUsdFromDecimillicents(query.data.totalCostDecimillicents)}
      </span>
    )
  }

  return (
    <Card data-testid="usage-breakdown-card">
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>
          Credits consumed over the last 30 days, broken down by category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col">
          {rows.map((row) => (
            <div
              key={row.key}
              data-testid={row.testId}
              className="flex items-center justify-between border-b border-border py-2 last:border-b-0"
            >
              <span className="text-sm">{row.label}</span>
              {renderCell(row.query)}
            </div>
          ))}
          <div
            data-testid="usage-row-total"
            className="mt-2 flex items-center justify-between border-t border-border pt-2"
          >
            <span className="text-sm font-semibold">Total</span>
            <span className="text-sm font-semibold">
              {formatUsdFromDecimillicents(combinedTotal)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
