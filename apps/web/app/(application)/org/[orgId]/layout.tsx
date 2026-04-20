'use client'

import { use, type ReactNode } from 'react'
import { SuspensionBanner } from '../../../../components/SuspensionBanner'

/**
 * Per-org layout: mounts the SuspensionBanner above every page nested
 * under `/org/[orgId]/...`. The banner reads the credits-balance
 * endpoint, so React Query dedupes the request with any sibling page
 * that already calls it (e.g. settings).
 *
 * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
 */
export default function OrgLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ orgId: string }>
}): React.ReactElement {
  const { orgId } = use(params)

  return (
    <>
      <SuspensionBanner organizationId={orgId} />
      {children}
    </>
  )
}
