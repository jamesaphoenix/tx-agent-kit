import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { useRouter } from 'expo-router'
import { SignOutButton } from './SignOutButton'
import { clientApi } from '../lib/client-api'
import { log } from '../lib/log'
import { notify } from '../lib/notify'
import { sessionStoreActions } from '../stores/session-store'

vi.mock('../lib/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../lib/client-api', () => ({
  clientApi: {
    signOut: vi.fn()
  }
}))

vi.mock('../lib/notify', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('../stores/session-store', () => ({
  sessionStoreActions: {
    setPrincipal: vi.fn(),
    clear: vi.fn()
  }
}))

const mockReplace = vi.fn()
const mockRouter = { replace: mockReplace, push: vi.fn(), back: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  ;(useRouter as Mock).mockReturnValue(mockRouter)
})

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

describe('SignOutButton', () => {
  it('renders Sign out text', () => {
    const tree = create(<SignOutButton />)
    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Sign out')
  })

  it('calls signOut, clears session, and redirects to sign-in', async () => {
    ;(clientApi.signOut as Mock).mockResolvedValue(undefined)

    const tree = create(<SignOutButton />)
    const button = findByType(tree.root, 'TouchableOpacity')[0]

    await act(async () => {
      button.props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.signOut).toHaveBeenCalled()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(notify.info).toHaveBeenCalledWith('Signed out')
    expect(mockReplace).toHaveBeenCalledWith('/sign-in')
  })

  it('prevents double-submit while pending', async () => {
    let resolveSignOut!: (v: unknown) => void
    ;(clientApi.signOut as Mock).mockImplementation(
      () => new Promise((r) => { resolveSignOut = r })
    )

    const tree = create(<SignOutButton />)
    const button = findByType(tree.root, 'TouchableOpacity')[0]

    // First press
    await act(async () => {
      button.props.onPress()
    })

    // Button should be disabled while pending
    expect(findByType(tree.root, 'TouchableOpacity')[0].props.disabled).toBe(true)

    // Resolve the pending request
    await act(async () => {
      resolveSignOut(undefined)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.signOut).toHaveBeenCalledTimes(1)
  })

  it('shows error and resets pending state when signOut fails', async () => {
    ;(clientApi.signOut as Mock).mockRejectedValue(new Error('Network error'))

    const tree = create(<SignOutButton />)
    const button = findByType(tree.root, 'TouchableOpacity')[0]

    await act(async () => {
      button.props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(notify.error).toHaveBeenCalledWith('Sign out failed')
    expect(log.error).toHaveBeenCalledWith('Sign out failed', expect.any(Error))

    // Session is always cleared and user is redirected even on failure
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/sign-in')

    // Button should show "Sign out" again, not "Signing out..."
    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Sign out')
  })
})
