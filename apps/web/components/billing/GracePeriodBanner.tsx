'use client'

import { useBillingGetBillingSettings } from '@/lib/api/generated/billing/billing'
import { useHasPermission } from '@/hooks/use-permissions'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export interface GracePeriodBannerProps {
  readonly organizationId: string
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export function GracePeriodBanner({
  organizationId
}: GracePeriodBannerProps): React.ReactElement | null {
  const canManageBilling = useHasPermission('manage_billing')
  const query = useBillingGetBillingSettings(organizationId, {
    query: {}
  })

  const endsAt = query.data?.paymentGracePeriodEndsAt ?? null
  if (!canManageBilling || !endsAt) {
    return null
  }

  const formattedDeadline = dateFormatter.format(new Date(endsAt))

  return (
    <Card role="alert" className="border-amber-300 bg-amber-50 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-400 text-amber-900">
              Payment required
            </Badge>
            <span className="text-sm font-medium text-amber-950">
              Billing is in a payment grace period.
            </span>
          </div>
          <p className="text-sm text-amber-900">
            Update the saved card before {formattedDeadline} to restore healthy billing status.
          </p>
        </div>
        <a
          href={`/org/${organizationId}/billing/settings`}
          className="text-sm font-medium text-amber-950 underline underline-offset-4"
        >
          Billing settings
        </a>
      </CardContent>
    </Card>
  )
}
