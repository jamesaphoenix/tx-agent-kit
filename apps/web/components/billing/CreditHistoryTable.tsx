'use client'

import * as React from 'react'
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
import { useBillingGetCreditHistory } from '@/lib/api/generated/billing/billing'
import type { BillingGetCreditHistory200ItemsItem } from '@/lib/api/generated/schemas/billingGetCreditHistory200ItemsItem'
import type { BillingGetCreditHistory200ItemsItemEntryType } from '@/lib/api/generated/schemas/billingGetCreditHistory200ItemsItemEntryType'
import { getApiErrorMessage } from '@/lib/axios'
import { formatDateTime, formatUsdFromDecimillicents } from '@/lib/billing-format'

/**
 * Paginated credit ledger table. Reads from `useBillingGetCreditHistory`
 * and renders one row per ledger entry with date, type, reason, signed
 * amount, and the running balance recorded at write time. A "Load more"
 * button walks the cursor returned by the API.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — credit history
 */
export interface CreditHistoryTableProps {
  readonly organizationId: string
  readonly pageSize?: number
}

const PAGE_SIZE_DEFAULT = 20

const ENTRY_TYPE_LABEL: Record<BillingGetCreditHistory200ItemsItemEntryType, string> = {
  purchase: 'Top-up',
  usage: 'Usage',
  adjustment: 'Adjustment',
  refund: 'Refund',
  auto_recharge: 'Auto-recharge',
  reserve: 'Reserved',
  release: 'Released'
}

/**
 * Drive the row's red/green direction from the numeric value of
 * `amountDecimillicents` directly. Backend writes refund rows with a
 * negative amount and usage rows with a negative amount, so a single
 * sign check is unambiguous and survives a future entry type that
 * stores a positive refund or a positive release. The previous
 * implementation kept a hardcoded `DEBIT_ENTRY_TYPES = {usage, reserve}`
 * set and called `Math.abs(...)` before re-prefixing the sign, which
 * meant a positive `refund.amountDecimillicents` would be mis-rendered
 * with a `+` even though it was a debit (and vice versa).
 */
const isDebitAmount = (amountDecimillicents: number): boolean =>
  amountDecimillicents < 0

const formatSignedAmount = (entry: BillingGetCreditHistory200ItemsItem): string => {
  const abs = formatUsdFromDecimillicents(Math.abs(entry.amountDecimillicents))
  return isDebitAmount(entry.amountDecimillicents) ? `-${abs}` : `+${abs}`
}

export function CreditHistoryTable({
  organizationId,
  pageSize = PAGE_SIZE_DEFAULT
}: CreditHistoryTableProps): React.ReactElement {
  const [cursor, setCursor] = React.useState<string | undefined>(undefined)
  const [accumulated, setAccumulated] = React.useState<ReadonlyArray<BillingGetCreditHistory200ItemsItem>>([])
  const [seenCursor, setSeenCursor] = React.useState<string | null>(null)

  const historyQuery = useBillingGetCreditHistory(organizationId, {
    limit: String(pageSize),
    ...(cursor === undefined ? {} : { cursor })
  })

  React.useEffect(() => {
    const data = historyQuery.data
    if (!data) {
      return
    }
    // Append only once per distinct cursor fetch.
    const cursorKey = cursor ?? '__first__'
    if (seenCursor === cursorKey) {
      return
    }
    setSeenCursor(cursorKey)
    setAccumulated((prev) =>
      cursorKey === '__first__' ? data.items : [...prev, ...data.items]
    )
  }, [historyQuery.data, cursor, seenCursor])

  const hasMore = historyQuery.data?.hasMore ?? false
  const nextCursor = historyQuery.data?.cursor ?? null
  const errorMessage = historyQuery.isError
    ? getApiErrorMessage(historyQuery.error, 'Could not load credit history.')
    : null

  const handleLoadMore = (): void => {
    if (nextCursor) {
      setCursor(nextCursor)
    }
  }

  return (
    <Card data-testid="credit-history-table">
      <CardHeader>
        <CardTitle>Credit history</CardTitle>
        <CardDescription>
          Every credit mutation — purchases, usage, refunds — in one
          immutable audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
          >
            {errorMessage}
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accumulated.length === 0 && historyQuery.isSuccess ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No credit history yet. Top up your wallet to get started.
                </TableCell>
              </TableRow>
            ) : null}
            {accumulated.length === 0 && historyQuery.isPending ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Loading credit history…
                </TableCell>
              </TableRow>
            ) : null}
            {accumulated.map((entry) => (
              <TableRow key={entry.id} data-testid={`credit-history-row-${entry.id}`}>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {ENTRY_TYPE_LABEL[entry.entryType]}
                </TableCell>
                <TableCell className="text-sm">{entry.reason}</TableCell>
                <TableCell
                  className={`text-right text-sm font-medium ${
                    isDebitAmount(entry.amountDecimillicents) ? 'text-red-600' : 'text-emerald-600'
                  }`}
                >
                  {formatSignedAmount(entry)}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {formatUsdFromDecimillicents(entry.balanceAfter)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {hasMore ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              className="btn secondary"
              onClick={handleLoadMore}
              disabled={historyQuery.isFetching}
            >
              {historyQuery.isFetching ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
