import { randomUUID } from 'node:crypto'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { sessionStore, sessionStoreActions } from '@/stores/session-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockRouter, mockRouter } from '../integration/mocks/next-navigation'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { SignOutButton } from './SignOutButton'

describe('SignOutButton integration', () => {
  beforeEach(() => {
    resetMockRouter()
    writeAuthToken('integration-sign-out-token')
    sessionStoreActions.setPrincipal({
      userId: randomUUID(),
      email: 'signed-in-user@example.com',
      workspaceId: undefined,
      roles: ['member']
    })
  })

  it('clears auth session and redirects to sign-in', async () => {
    const user = userEvent.setup()

    renderWithProviders(<SignOutButton />)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in')
    })

    expect(readAuthToken()).toBeNull()
    expect(sessionStore.state.principal).toBeNull()
    expect(sessionStore.state.isReady).toBe(true)
  })

  it('clears session and redirects even when signOut rejects', async () => {
    vi.spyOn(clientApi, 'signOut').mockRejectedValueOnce(new Error('network failure'))
    const user = userEvent.setup()

    renderWithProviders(<SignOutButton />)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in')
    })

    expect(sessionStore.state.principal).toBeNull()
    expect(sessionStore.state.isReady).toBe(true)
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeDisabled()

    vi.restoreAllMocks()
  })
})
