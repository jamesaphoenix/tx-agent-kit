'use client'

import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useHasPermission } from '@/hooks/use-permissions'
import {
  getBillingGetNoCapReminderQueryKey,
  useBillingDismissNoCapReminder,
  useBillingGetBillingSettings,
  useBillingGetNoCapReminder
} from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface NoCapReminderCardProps {
  readonly organizationId: string
}

export function NoCapReminderCard({
  organizationId
}: NoCapReminderCardProps): React.ReactElement | null {
  const queryClient = useQueryClient()
  const canManageBilling = useHasPermission('manage_billing')
  const billingQuery = useBillingGetBillingSettings(organizationId, {
    query: {
      enabled: canManageBilling
    }
  })
  const reminderQuery = useBillingGetNoCapReminder(organizationId, {
    query: {
      enabled: canManageBilling
    }
  })
  const dismissMutation = useBillingDismissNoCapReminder({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(
          getBillingGetNoCapReminderQueryKey(organizationId),
          { dismissed: true }
        )
      },
      onError: () => {
        notify.error('Failed to dismiss spend cap reminder')
      }
    }
  })

  if (!canManageBilling) {
    return null
  }

  if (
    billingQuery.isPending
    || reminderQuery.isPending
    || billingQuery.data === undefined
    || reminderQuery.data === undefined
    || reminderQuery.data.dismissed
    || billingQuery.data.usageCapDecimillicents !== null
  ) {
    return null
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>No spend cap set</CardTitle>
        <CardDescription>
          Consider adding one for peace of mind. It is optional and can be changed anytime.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={`/org/${organizationId}/billing/settings`}
          className={buttonVariants({ variant: 'default' })}
        >
          Set a cap
        </Link>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void dismissMutation.mutateAsync({ organizationId })
          }}
          disabled={dismissMutation.isPending}
        >
          {dismissMutation.isPending ? 'Dismissing...' : 'Dismiss'}
        </Button>
      </CardContent>
    </Card>
  )
}
