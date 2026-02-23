import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { AuthBootstrapProvider } from './AuthBootstrapProvider'
import { readAuthToken, clearAuthToken } from '../../lib/auth-token'
import { log } from '../../lib/log'
import { clientApi, ApiClientError } from '../../lib/client-api'
import { sessionStoreActions } from '../../stores/session-store'

vi.mock('../../lib/auth-token', () => ({
  readAuthToken: vi.fn(),
  clearAuthToken: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../lib/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../../lib/client-api', () => {
  class MockApiClientError extends Error {
    readonly status: number | undefined
    constructor(message: string, status?: number) {
      super(message)
      Object.setPrototypeOf(this, new.target.prototype)
      this.name = 'ApiClientError'
      this.status = status
    }
  }
  return {
    ApiClientError: MockApiClientError,
    clientApi: {
      me: vi.fn()
    }
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
  roles: ['member'] as readonly string[]
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
    ;(readAuthToken as Mock).mockResolvedValue(null)

    const tree = create(
      <AuthBootstrapProvider>
        <div>child content</div>
      </AuthBootstrapProvider>
    )

    expect(tree.toJSON()).toBeTruthy()
  })

  it('clears session when no token is stored', async () => {
    ;(readAuthToken as Mock).mockResolvedValue(null)

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(readAuthToken).toHaveBeenCalled()
    expect(clientApi.me).not.toHaveBeenCalled()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
  })

  it('sets principal when token exists and me() succeeds', async () => {
    ;(readAuthToken as Mock).mockResolvedValue('valid-jwt')
    ;(clientApi.me as Mock).mockResolvedValue(principal)

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(clientApi.me).toHaveBeenCalled()
    expect(sessionStoreActions.setPrincipal).toHaveBeenCalledWith(principal)
    expect(clearAuthToken).not.toHaveBeenCalled()
  })

  it('clears token and session on 401 auth rejection', async () => {
    ;(readAuthToken as Mock).mockResolvedValue('expired-jwt')
    ;(clientApi.me as Mock).mockRejectedValue(new ApiClientError('Unauthorized', 401))

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(log.error).toHaveBeenCalledWith('Auth bootstrap failed', expect.any(Error))
    expect(clearAuthToken).toHaveBeenCalled()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(sessionStoreActions.setPrincipal).not.toHaveBeenCalled()
  })

  it('clears token and session on 403 auth rejection', async () => {
    ;(readAuthToken as Mock).mockResolvedValue('forbidden-jwt')
    ;(clientApi.me as Mock).mockRejectedValue(new ApiClientError('Forbidden', 403))

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(log.error).toHaveBeenCalledWith('Auth bootstrap failed', expect.any(Error))
    expect(clearAuthToken).toHaveBeenCalled()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(sessionStoreActions.setPrincipal).not.toHaveBeenCalled()
  })

  it('does NOT clear token on network errors but still clears session', async () => {
    ;(readAuthToken as Mock).mockResolvedValue('valid-jwt')
    ;(clientApi.me as Mock).mockRejectedValue(new Error('Network error'))

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(log.error).toHaveBeenCalledWith('Auth bootstrap failed', expect.any(Error))
    expect(clearAuthToken).not.toHaveBeenCalled()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
  })

  it('does NOT clear token on 500 server errors but still clears session', async () => {
    ;(readAuthToken as Mock).mockResolvedValue('valid-jwt')
    ;(clientApi.me as Mock).mockRejectedValue(new ApiClientError('Server error', 500))

    create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    expect(log.error).toHaveBeenCalledWith('Auth bootstrap failed', expect.any(Error))
    expect(clearAuthToken).not.toHaveBeenCalled()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
  })

  it('does not update state after unmount (active flag)', async () => {
    let resolveMe: (value: unknown) => void
    ;(readAuthToken as Mock).mockResolvedValue('valid-jwt')
    ;(clientApi.me as Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveMe = resolve
      })
    )

    const tree = create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    // Confirm bootstrap reached the me() suspension point before unmount
    expect(clientApi.me).toHaveBeenCalled()

    await act(async () => {
      tree.unmount()
    })

    await act(async () => {
      resolveMe!(principal)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(sessionStoreActions.setPrincipal).not.toHaveBeenCalled()
  })

  it('does not clear session after unmount during auth error handling', async () => {
    let resolveClear!: () => void
    ;(readAuthToken as Mock).mockResolvedValue('valid-jwt')
    ;(clientApi.me as Mock).mockRejectedValue(new ApiClientError('Unauthorized', 401))
    ;(clearAuthToken as Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveClear = resolve
      })
    )

    const tree = create(
      <AuthBootstrapProvider>
        <div />
      </AuthBootstrapProvider>
    )

    await flush()

    // clearAuthToken is now in flight
    expect(clearAuthToken).toHaveBeenCalled()

    // Unmount while clearAuthToken is pending
    await act(async () => {
      tree.unmount()
    })

    // Resolve clearAuthToken after unmount
    await act(async () => {
      resolveClear()
      await new Promise((r) => setTimeout(r, 0))
    })

    // sessionStoreActions.clear should NOT be called because active=false
    expect(sessionStoreActions.clear).not.toHaveBeenCalled()
  })
})
