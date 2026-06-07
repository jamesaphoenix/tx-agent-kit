// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { DashboardShell } from './DashboardShell'

// RouteTransitionProvider (rendered by AppShell) needs a router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

// Stub the heavy sidebar with a counting sentinel so the test focuses purely on
// the shell-vs-page mounting contract.
vi.mock('./AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />
}))

// SidebarProvider/SidebarInset/SidebarTrigger read no external state we care
// about here; render them as their real (lightweight) implementations.

const countSidebars = (): number => screen.queryAllByTestId('app-sidebar').length

describe('AppShell + DashboardShell mounting contract', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders exactly one sidebar when a page uses DashboardShell inside AppShell', () => {
    render(
      <AppShell>
        <DashboardShell title="Queue" subtitle="Review work">
          <p>page content</p>
        </DashboardShell>
      </AppShell>
    )

    expect(countSidebars()).toBe(1)
    expect(screen.getByText('page content')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Queue' })).toBeTruthy()
  })

  it('does not mount a second sidebar even when multiple pages render DashboardShell inside one AppShell', () => {
    // Simulates the persistent-shell guarantee: navigating between pages must
    // not stack additional sidebars under the single layout-level AppShell.
    render(
      <AppShell>
        <DashboardShell title="A" subtitle="first">
          <p>first</p>
        </DashboardShell>
        <DashboardShell title="B" subtitle="second">
          <p>second</p>
        </DashboardShell>
      </AppShell>
    )

    expect(countSidebars()).toBe(1)
  })

  it('mounts its own sidebar when DashboardShell is used standalone (no surrounding AppShell)', () => {
    render(
      <DashboardShell title="Organizations" subtitle="All orgs">
        <p>standalone</p>
      </DashboardShell>
    )

    expect(countSidebars()).toBe(1)
    expect(screen.getByText('standalone')).toBeTruthy()
  })
})
