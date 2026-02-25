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
  principalEmail?: string | null
  orgId?: string
  teamId?: string
  metrics?: DashboardMetric[]
}

const metricToneClass = (tone: DashboardMetric['tone']): string => {
  if (tone === 'success') {
    return 'is-success'
  }

  if (tone === 'warning') {
    return 'is-warning'
  }

  return 'is-default'
}

export function DashboardShell({
  title,
  subtitle,
  children,
  principalEmail,
  orgId,
  teamId,
  metrics = []
}: DashboardShellProps) {
  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          '--sidebar-width': '18rem',
          '--sidebar-width-mobile': '18rem'
        } as CSSProperties
      }
    >
      <div className="dashboard-shell-root">
        <AppSidebar orgId={orgId} teamId={teamId} principalEmail={principalEmail} />
        <SidebarInset>
          <div className="dashboard-shell-main">
            <header className="dashboard-shell-topbar">
              <div className="dashboard-shell-topbar-left">
                <SidebarTrigger />
                <div className="dashboard-shell-context">
                  <span className="dashboard-shell-context-kicker">OctoSpark Command</span>
                  <strong className="dashboard-shell-context-title">{title}</strong>
                </div>
              </div>
            </header>

            <section className="dashboard-shell-hero">
              <div className="dashboard-shell-hero-copy">
                <h1>{title}</h1>
                <p>{subtitle}</p>
              </div>

              {metrics.length > 0 && (
                <div className="dashboard-shell-metrics">
                  {metrics.map((metric) => (
                    <article
                      key={metric.label}
                      className={`dashboard-shell-metric ${metricToneClass(metric.tone)}`}
                    >
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="dashboard-shell-content">
              {children}
            </section>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
