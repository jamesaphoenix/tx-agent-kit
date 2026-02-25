import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import DashboardScreen from './dashboard'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

vi.mock('expo-router', () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  useFocusEffect: vi.fn((cb: () => (() => void) | void) => {
    const { useEffect } = require('react')
    useEffect(() => {
      const cleanup = cb()
      return typeof cleanup === 'function' ? cleanup : undefined
    }, [])
  })
}))

vi.mock('../../lib/client-auth', () => ({
  ensureSessionOrRedirect: vi.fn(),
  handleUnauthorizedApiError: vi.fn()
}))

vi.mock('../../lib/client-api', () => ({
  clientApi: {
    me: vi.fn(),
    listOrganizations: vi.fn()
  }
}))

vi.mock('../../components/SignOutButton', () => ({
  SignOutButton: () => require('react').createElement('SignOutButton')
}))

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

const principal = { userId: 'u-1', email: 'test@co.com', roles: ['member'] as readonly string[] }
const organization = { id: 'o-1', name: 'Alpha', ownerUserId: 'u-1' }

describe('DashboardScreen', () => {
  it('stops loading without API calls when no session exists', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(false)

    const tree = create(<DashboardScreen />)
    await flush()

    expect(clientApi.me).not.toHaveBeenCalled()
    const json = JSON.stringify(tree.toJSON())
    expect(json).not.toContain('test@co.com')
  })

  it('loads and renders principal and organizations on success', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.me as Mock).mockResolvedValue(principal)
    ;(clientApi.listOrganizations as Mock).mockResolvedValue({ organizations: [organization] })

    const tree = create(<DashboardScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('test@co.com')
    expect(json).toContain('Alpha')
  })

  it('shows empty state when there are no organizations', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.me as Mock).mockResolvedValue(principal)
    ;(clientApi.listOrganizations as Mock).mockResolvedValue({ organizations: [] })

    const tree = create(<DashboardScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('No organizations yet.')
  })

  it('delegates 401 errors to handleUnauthorizedApiError', async () => {
    const err = new Error('unauthorized')
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.me as Mock).mockRejectedValue(err)
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(true)

    create(<DashboardScreen />)
    await flush()

    expect(handleUnauthorizedApiError).toHaveBeenCalledWith(err, expect.anything(), '/dashboard')
  })

  it('shows error message on non-auth API failure', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.me as Mock).mockRejectedValue(new Error('Network error'))
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(false)

    const tree = create(<DashboardScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Network error')
    expect(json).toContain('Retry')
  })
})
