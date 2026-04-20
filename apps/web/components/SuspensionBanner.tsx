'use client'

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { useHasPermission } from '../hooks/use-permissions'
import { useBillingGetCreditBalance } from '../lib/api/generated/billing/billing'

/**
 * Persistent banner that surfaces an organization-level suspension to
 * the org admin. Reads the same `getCreditBalance` endpoint the org
 * settings page uses (so React Query dedupes the request) and only
 * renders when the response carries `isSuspended: true`.
 *
 * The banner is purely informational — credit-consuming operations are
 * already blocked at the credit-service.reserve seam (the API will
 * return a 402). This component just makes the cause visible to the
 * org admin so they know to top up.
 *
 * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
 */
export interface SuspensionBannerProps {
  readonly organizationId: string
}

const formatRelativeTimestamp = (iso: string): string => {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return 'recently'
  }
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes.toString()}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours.toString()}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days.toString()}d ago`
}

export function SuspensionBanner({
  organizationId
}: SuspensionBannerProps): React.ReactElement | null {
  const canManageBilling = useHasPermission('manage_billing')
  const query = useBillingGetCreditBalance(organizationId)

  if (!canManageBilling || !query.data?.isSuspended) {
    return null
  }

  const suspendedAtIso = query.data.suspendedAt
  const relativeLabel = suspendedAtIso ? formatRelativeTimestamp(suspendedAtIso) : 'recently'

  return (
    <div
      role="alert"
      className="border border-red-300 bg-red-50 text-red-900 rounded-lg p-4 mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          Your organization is suspended.
        </p>
        <p className="text-sm">
          Credit-consuming operations are blocked ({relativeLabel}). Top up
          your balance or update your saved payment method to resume.
        </p>
      </div>
      <Link
        href={`/org/${organizationId}/billing`}
        className={buttonVariants({
          variant: 'destructive',
          className: 'shrink-0'
        })}
      >
        Open billing
      </Link>
    </div>
  )
}
