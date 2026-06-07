'use client'

import { use, type ReactNode } from 'react'
import { AppShell } from '../../../../components/AppShell'
import { SuspensionBanner } from '../../../../components/SuspensionBanner'

/**
 * Per-org layout: mounts the persistent {@link AppShell} (sidebar + inset
 * chrome) once for every page nested under `/org/[orgId]/...`, so the sidebar
 * and org/workspace context survive client-side navigation instead of
 * remounting per page. Pages render their header + content through
 * `DashboardShell`, which detects the surrounding shell and skips mounting a
 * second sidebar.
 *
 * The SuspensionBanner is rendered inside the shell above the page content. It
 * reads the credits-balance endpoint, so React Query dedupes the request with
 * any sibling page that already calls it (e.g. settings).
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
    <AppShell>
      <SuspensionBanner organizationId={orgId} />
      {children}
    </AppShell>
  )
}
