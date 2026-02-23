import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import InvitationsScreen from './invitations'
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
    listInvitations: vi.fn(),
    listWorkspaces: vi.fn()
  }
}))

vi.mock('../../components/CreateInvitationForm', () => ({
  CreateInvitationForm: (props: Record<string, unknown>) =>
    require('react').createElement('CreateInvitationForm', props)
}))

vi.mock('../../components/AcceptInvitationForm', () => ({
  AcceptInvitationForm: (props: Record<string, unknown>) =>
    require('react').createElement('AcceptInvitationForm', props)
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
const invitation = { id: 'inv-1', email: 'peer@co.com', role: 'member', status: 'pending', workspaceId: 'w-1' }

describe('InvitationsScreen', () => {
  it('stops loading without API calls when no session exists', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(false)

    create(<InvitationsScreen />)
    await flush()

    expect(clientApi.listInvitations).not.toHaveBeenCalled()
    expect(clientApi.listWorkspaces).not.toHaveBeenCalled()
  })

  it('loads invitations and workspaces on success', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listInvitations as Mock).mockResolvedValue({ invitations: [invitation] })
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [workspace] })

    const tree = create(<InvitationsScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('peer@co.com')
    expect(json).toContain('member')
  })

  it('shows empty state when no invitations exist', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listInvitations as Mock).mockResolvedValue({ invitations: [] })
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [] })

    const tree = create(<InvitationsScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('No invitations yet.')
  })

  it('delegates auth errors to handleUnauthorizedApiError', async () => {
    const err = new Error('unauthorized')
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listInvitations as Mock).mockRejectedValue(err)
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [] })
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(true)

    create(<InvitationsScreen />)
    await flush()

    expect(handleUnauthorizedApiError).toHaveBeenCalledWith(err, expect.anything(), '/invitations')
  })

  it('shows error message on non-auth API failure', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.listInvitations as Mock).mockRejectedValue(new Error('Connection refused'))
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [] })
    ;(handleUnauthorizedApiError as Mock).mockResolvedValue(false)

    const tree = create(<InvitationsScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Connection refused')
    expect(json).toContain('Retry')
  })
})
