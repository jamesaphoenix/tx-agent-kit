import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { AuthBootstrapProvider } from './AuthBootstrapProvider'
import { log } from '../../lib/log'
import { restoreCurrentPrincipal } from '../../lib/client-api'
import { sessionStoreActions } from '../../stores/session-store'

vi.mock('../../lib/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../../lib/client-api', () => {
  return {
    restoreCurrentPrincipal: vi.fn()
  }
})

vi.mock('../../stores/session-store', () => ({
  sessionStoreActions: {
    setPrincipal: vi.fn(),
    clear: vi.fn()
  }
}))

const principal = {
  userId: 'u-1',
  email: 'test@example.com',
  roles: ['member'] as readonly string[],
  permissions: [] as readonly string[]
}

beforeEach(() => {
  vi.clearAllMocks()
})

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('AuthBootstrapProvider', () => {
  it('renders children', () => {
    ;(restoreCurrentPrincipal as Mock).mockResolvedValue(null)

    const tree = create(
      <AuthBootstrapProvider>
        <div>child content</div>
      </AuthBootstrapProvider>
    )

    expect(tree.toJSON()).toBeTruthy()
  })

  it('clears session when no token is stored', async () => {
    ;(restoreCurrentPrincipal as Mock).mockResolvedValue(null)

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(restoreCurrentPrincipal).toHaveBeenCalled()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
  })

  it('sets principal when token exists and me() succeeds', async () => {
    ;(restoreCurrentPrincipal as Mock).mockResolvedValue(principal)

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(restoreCurrentPrincipal).toHaveBeenCalled()
    expect(sessionStoreActions.setPrincipal).toHaveBeenCalledWith(principal)
  })

  it('clears session on auth rejection already normalized by the shared helper', async () => {
    ;(restoreCurrentPrincipal as Mock).mockResolvedValue(null)

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(sessionStoreActions.setPrincipal).not.toHaveBeenCalled()
  })

  it('logs and clears session on non-auth errors', async () => {
    ;(restoreCurrentPrincipal as Mock).mockRejectedValue(new Error('Network error'))

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(log.error).toHaveBeenCalledWith('Auth bootstrap failed', expect.any(Error))
    expect(sessionStoreActions.clear).toHaveBeenCalled()
  })

  it('does not update state after unmount (active flag)', async () => {
    let resolveBootstrap: (value: unknown) => void
    ;(restoreCurrentPrincipal as Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveBootstrap = resolve
      })
    )

    const tree = create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(restoreCurrentPrincipal).toHaveBeenCalled()

    await act(async () => {
      tree.unmount()
    })

    await act(async () => {
      resolveBootstrap!(principal)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(sessionStoreActions.setPrincipal).not.toHaveBeenCalled()
  })

  it('does not clear session after unmount during async error handling', async () => {
    let rejectBootstrap!: (error: unknown) => void
    ;(restoreCurrentPrincipal as Mock).mockReturnValue(
      new Promise((_, reject) => {
        rejectBootstrap = reject
      })
    )

    const tree = create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(restoreCurrentPrincipal).toHaveBeenCalled()

    await act(async () => {
      tree.unmount()
    })

    await act(async () => {
      rejectBootstrap(new Error('late failure'))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(sessionStoreActions.clear).not.toHaveBeenCalled()
  })
})
