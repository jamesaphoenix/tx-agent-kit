'use client'

import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { AppSidebar } from './AppSidebar'
import { RouteProgressBar, RouteTransitionProvider } from './RouteTransition'
import { SidebarInset, SidebarProvider } from './ui/sidebar'

/**
 * Marks that a persistent {@link AppShell} (sidebar + inset chrome) is already
 * mounted higher in the tree - typically from a route-group layout. Pages that
 * still render {@link DashboardShell} read this so they render only their
 * header + content instead of mounting a second sidebar.
 *
 * Mounting the chrome once in the layout (rather than per-page) is what keeps
 * the sidebar and org/workspace context from unmounting and re-fetching on
 * every navigation.
 */
export const AppShellContext = createContext(false)

export const useIsInsideAppShell = (): boolean => useContext(AppShellContext)

export interface AppShellProps {
  readonly children: ReactNode
}

/**
 * Persistent application chrome: the sidebar rail plus the inset content area.
 * Mount this once in a layout so it survives client-side navigation. The
 * sidebar self-sources its org/workspace/principal context from the route and
 * session store, so no props need threading through.
 */
export function AppShell({ children }: AppShellProps): React.ReactElement {
  return (
    <AppShellContext.Provider value={true}>
      <RouteTransitionProvider>
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
            <AppSidebar />
            <SidebarInset className="relative">
              <RouteProgressBar />
              {children}
            </SidebarInset>
          </div>
        </SidebarProvider>
      </RouteTransitionProvider>
    </AppShellContext.Provider>
  )
}
