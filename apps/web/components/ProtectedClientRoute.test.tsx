// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuthToken, writeAuthToken } from '@/lib/auth-token'
import {
  sessionStore,
  sessionStoreActions,
  sessionStoreInitialState
} from '@/stores/session-store'
import { ProtectedClientRoute } from './ProtectedClientRoute'

const replaceMock = vi.fn()
let pathname = '/org'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    replace: replaceMock
  })
}))

describe('ProtectedClientRoute', () => {
  beforeEach(() => {
    pathname = '/org'
    replaceMock.mockClear()
    clearAuthToken()
    sessionStore.setState(() => sessionStoreInitialState)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows an accessible loading state until the session is ready', () => {
    render(
      <ProtectedClientRoute>
        <div>Protected content</div>
      </ProtectedClientRoute>
    )

    expect(screen.getByRole('status', { name: 'Checking session' })).not.toBeNull()
    expect(screen.queryByText('Protected content')).toBeNull()
  })

  it('redirects unauthenticated ready sessions and keeps the loading boundary visible', async () => {
    sessionStoreActions.clear()

    render(
      <ProtectedClientRoute>
        <div>Protected content</div>
      </ProtectedClientRoute>
    )

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/sign-in?next=%2Forg')
    })
    expect(screen.getByRole('status', { name: 'Checking session' })).not.toBeNull()
    expect(screen.queryByText('Protected content')).toBeNull()
  })

  it('renders children for authenticated sessions', () => {
    writeAuthToken('access-token')
    sessionStoreActions.setPrincipal({
      userId: 'user-1',
      email: 'member@example.com',
      roles: ['member'],
      permissions: []
    })

    render(
      <ProtectedClientRoute>
        <div>Protected content</div>
      </ProtectedClientRoute>
    )

    expect(screen.queryByRole('status', { name: 'Checking session' })).toBeNull()
    expect(screen.getByText('Protected content')).not.toBeNull()
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
