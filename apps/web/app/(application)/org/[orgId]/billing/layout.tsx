'use client'

import * as React from 'react'

/**
 * Billing pages render their own DashboardShell so the application
 * sidebar stays mounted at the viewport edge. This route layout is only
 * a pass-through boundary for the billing route group.
 *
 * @spec billing-and-pricing-design §"UI Surfaces"
 */
interface BillingLayoutProps {
  readonly children: React.ReactNode
}

export default function BillingLayout({ children }: BillingLayoutProps) {
  return <>{children}</>
}
