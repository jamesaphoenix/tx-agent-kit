// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mutableProcessEnv = process.env as Record<string, string | undefined>

const clearNodeEnv = (): void => {
  delete mutableProcessEnv.NEXT_PUBLIC_NODE_ENV
  delete mutableProcessEnv.NODE_ENV
}

vi.mock('./AuthBootstrapProvider', () => ({
  AuthBootstrapProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="auth-bootstrap-provider">{children}</div>
  )
}))

vi.mock('../../lib/url-state', () => ({
  UrlStateProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="url-state-provider">{children}</div>
  )
}))

vi.mock('../../lib/notify', () => ({
  NotifyToaster: () => <div data-testid="notify-toaster" />
}))

vi.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtools: () => <div data-testid="react-query-devtools" />
}))

vi.mock('../devtools/TanStackStoreDevtools', () => ({
  TanStackStoreDevtools: () => <div data-testid="tanstack-store-devtools" />
}))

const renderAppProviders = async (nodeEnv: string | null): Promise<void> => {
  if (nodeEnv === null) {
    clearNodeEnv()
  } else {
    mutableProcessEnv.NEXT_PUBLIC_NODE_ENV = nodeEnv
    mutableProcessEnv.NODE_ENV = nodeEnv
  }

  const { AppProviders } = await import('./AppProviders')
  render(
    <AppProviders>
      <span data-testid="app-providers-child">child</span>
    </AppProviders>
  )
}

describe('AppProviders', () => {
  beforeEach(() => {
    vi.resetModules()
    clearNodeEnv()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    clearNodeEnv()
  })

  it('renders TanStack devtools in non-production environments', async () => {
    await renderAppProviders('development')

    expect(screen.queryByTestId('app-providers-child')).not.toBeNull()
    expect(screen.queryByTestId('url-state-provider')).not.toBeNull()
    expect(screen.queryByTestId('auth-bootstrap-provider')).not.toBeNull()
    expect(screen.queryByTestId('notify-toaster')).not.toBeNull()
    expect(screen.queryByTestId('react-query-devtools')).not.toBeNull()
    expect(screen.queryByTestId('tanstack-store-devtools')).not.toBeNull()
  })

  it('hides TanStack devtools in production', async () => {
    await renderAppProviders('production')

    expect(screen.queryByTestId('app-providers-child')).not.toBeNull()
    expect(screen.queryByTestId('react-query-devtools')).toBeNull()
    expect(screen.queryByTestId('tanstack-store-devtools')).toBeNull()
  })

  it('defaults to showing devtools when NODE_ENV is not set', async () => {
    await renderAppProviders(null)

    expect(screen.queryByTestId('react-query-devtools')).not.toBeNull()
    expect(screen.queryByTestId('tanstack-store-devtools')).not.toBeNull()
  })
})
