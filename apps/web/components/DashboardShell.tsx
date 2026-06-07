'use client'

import type { ReactNode } from 'react'
import { AppShell, useIsInsideAppShell } from './AppShell'
import { SidebarTrigger } from './ui/sidebar'
import { cn } from '../lib/utils'

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
  /**
   * Ignored when rendered inside a layout-level AppShell (the common case): the
   * sidebar self-sources the principal from the session store. Retained for the
   * standalone-page fallback and call-site compatibility.
   */
  principalEmail?: string | null
  /** Ignored inside an AppShell; the sidebar self-sources orgId from the route. */
  orgId?: string
  /** Ignored inside an AppShell; the sidebar self-sources teamId from the route. */
  teamId?: string
  mainClassName?: string
  contentClassName?: string
  /** @deprecated Metrics are no longer rendered. Kept for backwards compatibility. */
  metrics?: DashboardMetric[]
}

/**
 * The per-page header row + content region that lives inside the persistent
 * {@link AppShell}. Rendered on its own when a shell is already mounted by a
 * layout; otherwise {@link DashboardShell} wraps it in its own {@link AppShell}.
 */
function DashboardShellContent({
  title,
  subtitle,
  children,
  actions,
  mainClassName,
  contentClassName
}: Pick<
  DashboardShellProps,
  'title' | 'subtitle' | 'children' | 'actions' | 'mainClassName' | 'contentClassName'
>) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', mainClassName)}>
      <header className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SidebarTrigger />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight leading-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            {actions}
          </div>
        ) : null}
      </header>

      <section className={cn('flex min-h-0 flex-1 flex-col p-4 sm:p-6', contentClassName)}>
        {children}
      </section>
    </div>
  )
}

/**
 * Page scaffold. When a persistent {@link AppShell} is already mounted by a
 * layout, this renders only the page header + content (reusing the existing
 * sidebar). On standalone pages with no surrounding shell, it mounts its own
 * {@link AppShell} so the sidebar still appears.
 *
 * Pages under `org/[orgId]` get the shell from the layout for free, so the
 * sidebar no longer remounts on navigation between them.
 */
export function DashboardShell(props: DashboardShellProps) {
  const insideShell = useIsInsideAppShell()
  const content = (
    <DashboardShellContent
      title={props.title}
      subtitle={props.subtitle}
      actions={props.actions}
      mainClassName={props.mainClassName}
      contentClassName={props.contentClassName}
    >
      {props.children}
    </DashboardShellContent>
  )

  if (insideShell) {
    return content
  }

  return <AppShell>{content}</AppShell>
}
