'use client'

import type { CSSProperties, ReactNode } from 'react'
import { AppSidebar } from './AppSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from './ui/sidebar'

interface DashboardMetric {
  label: string
  value: string
  tone?: 'default' | 'success' | 'warning'
}

interface DashboardShellProps {
  title: string
  subtitle: string
  children: ReactNode
  actions?: ReactNode
  principalEmail?: string | null
  orgId?: string
  teamId?: string
  /** @deprecated Metrics are no longer rendered. Kept for backwards compatibility. */
  metrics?: DashboardMetric[]
}

export function DashboardShell({
  title,
  subtitle,
  children,
  actions,
  principalEmail,
  orgId,
  teamId
}: DashboardShellProps) {
  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          '--sidebar-width': '14rem',
          '--sidebar-width-mobile': '14rem'
        } as CSSProperties
      }
    >
      <div className="flex min-h-dvh w-full">
        <AppSidebar orgId={orgId} teamId={teamId} principalEmail={principalEmail} />
        <SidebarInset>
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger />
                <div>
                  <h1 className="text-lg font-semibold tracking-tight leading-tight">{title}</h1>
                  <p className="text-sm text-muted-foreground">{subtitle}</p>
                </div>
              </div>
              {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
            </header>

            <section className="flex-1 p-6">
              {children}
            </section>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
