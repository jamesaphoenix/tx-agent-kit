import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import WorkspacesScreen from './workspaces'
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
    listWorkspaces: vi.fn()
  }
}))

vi.mock('../../components/CreateWorkspaceForm', () => ({
  CreateWorkspaceForm: (props: Record<string, unknown>) =>
    require('react').createElement('CreateWorkspaceForm', props)
}))

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

const workspace = { id: 'w-1', name: 'Alpha', ownerUserId: 'u-1' }

describe('WorkspacesScreen', () => {
  it('stops loading without API calls when no session exists', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(false)

    create(<WorkspacesScreen />)
    await flush()

    expect(clientApi.listWorkspaces).not.toHaveBeenCalled()
  })

  it('loads and renders workspaces on success', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [workspace] })

    const tree = create(<WorkspacesScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Alpha')
  })

  it('shows empty state when no workspaces exist', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [] })

    const tree = create(<WorkspacesScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('No workspaces yet.')
  })

  it('delegates auth errors to handleUnauthorizedApiError', async () => {
    const err = new Error('unauthorized')
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listWorkspaces as Mock).mockRejectedValue(err)
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(true)

    create(<WorkspacesScreen />)
    await flush()

    expect(handleUnauthorizedApiError).toHaveBeenCalledWith(err, expect.anything(), '/workspaces')
  })

  it('shows error message on non-auth API failure', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listWorkspaces as Mock).mockRejectedValue(new Error('Server down'))
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(false)

    const tree = create(<WorkspacesScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Server down')
    expect(json).toContain('Retry')
  })
})
