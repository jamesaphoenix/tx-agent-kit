import { randomUUID } from 'node:crypto'
import { clearAuthToken, readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { sessionStore, sessionStoreActions } from '@/stores/session-store'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '../integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { SignOutButton } from './SignOutButton'

describe('SignOutButton integration', () => {
  beforeEach(() => {
    resetIntegrationRouterLocation('/dashboard')
    writeAuthToken('integration-sign-out-token')
    sessionStoreActions.setPrincipal({
      userId: randomUUID(),
      email: 'signed-in-user@example.com',
      organizationId: undefined,
      roles: ['member']
    })
  })

  it('clears auth session and redirects to sign-in', async () => {
    const user = userEvent.setup()

    renderWithProviders(<SignOutButton />)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/sign-in')
    })

    expect(readAuthToken()).toBeNull()
    expect(sessionStore.state.principal).toBeNull()
    expect(sessionStore.state.isReady).toBe(true)
  })

  it('is idempotent when clicked while already signed out', async () => {
    clearAuthToken()
    sessionStoreActions.clear()
    const user = userEvent.setup()

    renderWithProviders(<SignOutButton />)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/sign-in')
    })

    expect(sessionStore.state.principal).toBeNull()
    expect(sessionStore.state.isReady).toBe(true)
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeDisabled()
  })
})
