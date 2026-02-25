import React from 'react'
import { randomUUID } from 'node:crypto'
import { AppProviders } from './AppProviders'
import { beforeEach, describe, expect, it } from 'vitest'
import { IntegrationRouterProvider } from '../../integration/support/next-router-context'
import { render, screen, userEvent, waitFor } from '../../integration/test-utils'
import { sessionStoreActions } from '../../stores/session-store'

const mutableProcessEnv = process.env as Record<string, string | undefined>

const renderAppProviders = (devtoolsMode: 'auto' | 'enabled' | 'disabled' = 'auto') => {
  return render(
    <IntegrationRouterProvider>
      <AppProviders devtoolsMode={devtoolsMode}>
        <main data-testid="app-providers-child">integration-child</main>
      </AppProviders>
    </IntegrationRouterProvider>
  )
}

describe('AppProviders integration', () => {
  beforeEach(() => {
    sessionStoreActions.clear()
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN =
      'https://public@example.ingest.sentry.io/123456'
    mutableProcessEnv.NEXT_PUBLIC_NODE_ENV = 'test'
  })

  it('renders TanStack devtools in auto mode for integration environment', () => {
    renderAppProviders('auto')

    expect(screen.getByTestId('app-providers-child')).toBeInTheDocument()
    expect(screen.getByTestId('react-query-devtools-container')).toBeInTheDocument()
    expect(screen.getByTestId('tanstack-store-devtools-toggle')).toBeInTheDocument()
  })

  it('renders real TanStack devtools and tracks session store updates', async () => {
    const user = userEvent.setup()

    renderAppProviders('enabled')

    expect(screen.getByTestId('app-providers-child')).toBeInTheDocument()
    expect(screen.getByTestId('react-query-devtools-container')).toBeInTheDocument()
    expect(screen.getByTestId('tanstack-store-devtools-toggle')).toBeInTheDocument()

    await user.click(screen.getByTestId('tanstack-store-devtools-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('tanstack-store-devtools-panel')).toBeInTheDocument()
    }, { timeout: 5_000 })

    sessionStoreActions.setPrincipal({
      userId: randomUUID(),
      email: 'devtools-integration@example.com',
      roles: ['member'],
      organizationId: undefined
    })

    await waitFor(() => {
      expect(screen.getByTestId('tanstack-store-devtools-current-state')).toHaveTextContent(
        'devtools-integration@example.com'
      )
    }, { timeout: 5_000 })

    expect(screen.getByTestId('tanstack-store-devtools-history-count')).toHaveTextContent(
      /snapshot/i
    )

    await user.click(screen.getByRole('button', { name: 'Clear history' }))

    expect(screen.getByTestId('tanstack-store-devtools-history-count')).toHaveTextContent(
      '1 snapshot'
    )
  })

  it('disables TanStack devtools when devtools mode is disabled', () => {
    renderAppProviders('disabled')

    expect(screen.getByTestId('app-providers-child')).toBeInTheDocument()
    expect(screen.queryByTestId('react-query-devtools-container')).toBeNull()
    expect(screen.queryByTestId('tanstack-store-devtools-toggle')).toBeNull()
  })

  it('keeps store snapshot history capped at the configured max history size', async () => {
    const user = userEvent.setup()

    renderAppProviders('enabled')

    await user.click(screen.getByTestId('tanstack-store-devtools-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('tanstack-store-devtools-panel')).toBeInTheDocument()
    }, { timeout: 5_000 })

    for (let index = 0; index < 45; index += 1) {
      sessionStoreActions.setPrincipal({
        userId: randomUUID(),
        email: `history-${index}@example.com`,
        roles: ['member'],
        organizationId: undefined
      })
    }

    await waitFor(() => {
      expect(screen.getAllByTestId('tanstack-store-devtools-history-entry')).toHaveLength(30)
      expect(screen.getByTestId('tanstack-store-devtools-history-count')).toHaveTextContent(
        '30 snapshots'
      )
    }, { timeout: 5_000 })

    expect(screen.getByTestId('tanstack-store-devtools-current-state')).toHaveTextContent(
      'history-44@example.com'
    )
  })
})
