import { createUser } from '@tx-agent-kit/testkit'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearAuthToken, readAuthToken, writeAuthToken } from './auth-token'
import { ApiClientError, clientApi } from './client-api'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from './client-auth'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '../integration/support/next-router-context'
import { createWebFactoryContext } from '../integration/support/web-integration-context'
import { sessionStore, sessionStoreActions } from '../stores/session-store'

const createIntegrationRouterAdapter = () => ({
  replace: (path: string): void => {
    resetIntegrationRouterLocation(path)
  }
})

const expectAsyncError = async (operation: () => Promise<unknown>): Promise<unknown> => {
  let capturedError: unknown = null

  try {
    await operation()
  } catch (error) {
    capturedError = error
  }

  if (capturedError === null) {
    throw new Error('Expected operation to fail but it succeeded')
  }

  return capturedError
}

describe('client-auth integration', () => {
  beforeEach(() => {
    clearAuthToken()
    sessionStoreActions.clear()
    resetIntegrationRouterLocation('/dashboard')
  })

  it('redirects missing sessions to sign-in', () => {
    const router = createIntegrationRouterAdapter()

    const hasSession = ensureSessionOrRedirect(router, '/organizations')

    expect(hasSession).toBe(false)
    expect(readIntegrationRouterLocation()).toEqual({
      pathname: '/sign-in',
      search: '?next=%2Forganizations'
    })
  })

  it('keeps authenticated sessions in place when a token exists', () => {
    writeAuthToken('existing-token')
    const router = createIntegrationRouterAdapter()

    const hasSession = ensureSessionOrRedirect(router, '/organizations')

    expect(hasSession).toBe(true)
    expect(readIntegrationRouterLocation()).toEqual({
      pathname: '/dashboard',
      search: ''
    })
  })

  it('clears auth token and session state after a real unauthorized API response', async () => {
    const factoryContext = createWebFactoryContext()
    const user = await createUser(factoryContext, {
      email: 'client-auth-integration@example.com',
      password: 'client-auth-integration-pass-12345',
      name: 'Client Auth Integration'
    })

    writeAuthToken(user.token)
    const principal = await clientApi.me()
    sessionStoreActions.setPrincipal(principal)

    writeAuthToken('invalid-token')

    const unauthorizedError = await expectAsyncError(() => clientApi.me())
    if (!(unauthorizedError instanceof ApiClientError)) {
      throw new Error(`Expected ApiClientError, received: ${String(unauthorizedError)}`)
    }

    expect([401, 403]).toContain(unauthorizedError.status)

    const router = createIntegrationRouterAdapter()
    const redirected = handleUnauthorizedApiError(unauthorizedError, router, '/dashboard')

    expect(redirected).toBe(true)
    expect(readAuthToken()).toBeNull()
    expect(sessionStore.state.principal).toBeNull()
    expect(sessionStore.state.isReady).toBe(true)
    expect(readIntegrationRouterLocation()).toEqual({
      pathname: '/sign-in',
      search: '?next=%2Fdashboard'
    })
  })
})
