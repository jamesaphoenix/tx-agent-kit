'use client'

import { useBillingGetCreditBalance } from '@/lib/api/generated/billing/billing'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatUsdFromDecimillicents } from './billing-utils'

export interface CreditBalanceWidgetProps {
  readonly organizationId: string
}

export function CreditBalanceWidget({
  organizationId
}: CreditBalanceWidgetProps): React.ReactElement {
  const query = useBillingGetCreditBalance(organizationId, {
    query: {}
  })

  const balance = query.data

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Credit balance</CardTitle>
        <CardDescription>
          Wallet balance, reserved funds, and current credit status.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Available</span>
          <span className="text-2xl font-semibold" aria-label="Available balance">
            {balance ? formatUsdFromDecimillicents(balance.availableDecimillicents) : '...'}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Total credits</span>
          <span className="text-lg font-medium" aria-label="Total credits">
            {balance ? formatUsdFromDecimillicents(balance.creditsBalanceDecimillicents) : '...'}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Reserved</span>
          <span className="text-lg font-medium" aria-label="Reserved credits">
            {balance ? formatUsdFromDecimillicents(balance.reservedCreditsDecimillicents) : '...'}
          </span>
        </div>
        <div className="sm:col-span-3 flex items-center gap-2">
          <Badge variant={balance?.isSuspended ? 'destructive' : 'secondary'}>
            {balance?.isSuspended ? 'Suspended' : 'Healthy'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
