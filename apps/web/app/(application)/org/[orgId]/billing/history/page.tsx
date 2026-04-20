'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useCurrentPrincipal } from '@/hooks/use-session-store'
import { useMyPermissions } from '@/hooks/use-permissions'
import { useBillingGetCreditHistory } from '@/lib/api/generated/billing/billing'
import { DashboardShell } from '@/components/DashboardShell'
import { BillingRouteNav } from '@/components/billing/BillingRouteNav'
import { GracePeriodBanner } from '@/components/billing/GracePeriodBanner'
import { formatUsdFromDecimillicents } from '@/components/billing/billing-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

const historyDateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export default function BillingHistoryPage() {
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const principal = useCurrentPrincipal()
  const permissionsQuery = useMyPermissions()
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([])

  const canManageBilling = permissionsQuery.data?.permissions.includes('manage_billing') ?? false
  const historyQuery = useBillingGetCreditHistory(
    orgId,
    { limit: '20', cursor },
    { query: {} }
  )

  const entries = historyQuery.data?.items ?? []

  return (
    <DashboardShell
      title="Credit history"
      subtitle="Immutable ledger of purchases, debits, recharges, holds, and releases."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      {permissionsQuery.isLoading || historyQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : null}

      {!permissionsQuery.isLoading && !canManageBilling ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Billing access required</CardTitle>
            <CardDescription>
              Only organization admins can inspect the credit ledger.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canManageBilling ? (
        <div className="flex flex-col gap-6">
          <BillingRouteNav organizationId={orgId} />
          <GracePeriodBanner organizationId={orgId} />

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Ledger entries</CardTitle>
              <CardDescription>
                Newest entries first. This ledger is append-only and used as the billing audit trail.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No credit ledger entries exist for this organization yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance after</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{historyDateFormatter.format(new Date(entry.createdAt))}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{entry.entryType}</Badge>
                        </TableCell>
                        <TableCell>{entry.reason}</TableCell>
                        <TableCell>{entry.referenceId ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          <span className={entry.amountDecimillicents < 0 ? 'text-red-700' : 'text-emerald-700'}>
                            {formatUsdFromDecimillicents(entry.amountDecimillicents)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatUsdFromDecimillicents(entry.balanceAfter)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const previous = cursorHistory[cursorHistory.length - 1]
                    setCursorHistory((current) => current.slice(0, -1))
                    setCursor(previous)
                  }}
                  disabled={cursorHistory.length === 0 || historyQuery.isFetching}
                >
                  Previous page
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (entries.length === 0) {
                      return
                    }
                    setCursorHistory((current) => [...current, cursor])
                    setCursor(entries[entries.length - 1]?.id)
                  }}
                  disabled={!historyQuery.data?.hasMore || historyQuery.isFetching || entries.length === 0}
                >
                  Next page
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </DashboardShell>
  )
}
