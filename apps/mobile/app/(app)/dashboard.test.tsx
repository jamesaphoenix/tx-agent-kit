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
    listWorkspaces: vi.fn(),
    listTasks: vi.fn()
  }
}))

vi.mock('../../components/CreateTaskForm', () => ({
  CreateTaskForm: (props: Record<string, unknown>) =>
    require('react').createElement('CreateTaskForm', props)
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
const workspace = { id: 'w-1', name: 'Alpha', ownerUserId: 'u-1' }
const task = { id: 't-1', title: 'Task one', description: null, status: 'open', workspaceId: 'w-1' }

describe('DashboardScreen', () => {
  it('stops loading without API calls when no session exists', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(false)

    const tree = create(<DashboardScreen />)
    await flush()

    expect(clientApi.me).not.toHaveBeenCalled()
    const json = JSON.stringify(tree.toJSON())
    expect(json).not.toContain('test@co.com')
  })

  it('loads and renders principal, workspaces, and tasks on success', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.me as Mock).mockResolvedValue(principal)
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [workspace] })
    ;(clientApi.listTasks as Mock).mockResolvedValue({ tasks: [task] })

    const tree = create(<DashboardScreen />)
    await flush()

    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('test@co.com')
    expect(json).toContain('Alpha')
    expect(json).toContain('Task one')
  })

  it('does not call listTasks when there are no workspaces', async () => {
    ;(ensureSessionOrRedirect as Mock).mockReturnValue(true)
    ;(clientApi.me as Mock).mockResolvedValue(principal)
    ;(clientApi.listWorkspaces as Mock).mockResolvedValue({ workspaces: [] })

    create(<DashboardScreen />)
    await flush()

    expect(clientApi.listTasks).not.toHaveBeenCalled()
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
