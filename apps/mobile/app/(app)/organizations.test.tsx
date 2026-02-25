import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import OrganizationsScreen from './organizations'
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
    listOrganizations: vi.fn()
  }
}))

vi.mock('../../components/CreateOrganizationForm', () => ({
  CreateOrganizationForm: (props: Record<string, unknown>) =>
    require('react').createElement('CreateOrganizationForm', props)
}))

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

const organization = { id: 'o-1', name: 'Alpha', ownerUserId: 'u-1' }

describe('OrganizationsScreen', () => {
  it('stops loading without API calls when no session exists', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(false)

    create(<OrganizationsScreen />)
    await flush()

    expect(clientApi.listOrganizations).not.toHaveBeenCalled()
  })

  it('loads and renders organizations on success', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listOrganizations as Mock).mockResolvedValue({ organizations: [organization] })

    const tree = create(<OrganizationsScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Alpha')
  })

  it('shows empty state when no organizations exist', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listOrganizations as Mock).mockResolvedValue({ organizations: [] })

    const tree = create(<OrganizationsScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('No organizations yet.')
  })

  it('delegates auth errors to handleUnauthorizedApiError', async () => {
    const err = new Error('unauthorized')
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listOrganizations as Mock).mockRejectedValue(err)
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(true)

    create(<OrganizationsScreen />)
    await flush()

    expect(handleUnauthorizedApiError).toHaveBeenCalledWith(err, expect.anything(), '/organizations')
  })

  it('shows error message on non-auth API failure', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listOrganizations as Mock).mockRejectedValue(new Error('Server down'))
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(false)

    const tree = create(<OrganizationsScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Server down')
    expect(json).toContain('Retry')
  })
})
