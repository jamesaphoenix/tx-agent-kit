import React from 'react'
import { randomUUID } from 'node:crypto'
import { create, act } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { createUser } from '../../../../packages/testkit/src/index.ts'
import { createMobileFactoryContext } from '../../integration/support/mobile-integration-context'
import { waitFor } from '../../integration/support/wait-for'
import { writeAuthToken } from '../../lib/auth-token'
import { sessionStore, sessionStoreSelectors } from '../../stores/session-store'
import { AuthBootstrapProvider } from './AuthBootstrapProvider'

describe('AuthBootstrapProvider integration', () => {
  it('hydrates principal from a stored token using the real mobile API client', async () => {
    const factoryContext = createMobileFactoryContext()

    const user = await createUser(factoryContext, {
      email: `mobile-bootstrap-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Bootstrap User'
    })

    await writeAuthToken(user.token)

    await act(async () => {
      create(
        <AuthBootstrapProvider>
          <React.Fragment />
        </AuthBootstrapProvider>
      )
    })

    await waitFor(() => sessionStoreSelectors.getPrincipal(sessionStore.state)?.userId === user.user.id)

    const principal = sessionStoreSelectors.getPrincipal(sessionStore.state)
    expect(principal?.userId).toBe(user.user.id)
    expect(principal?.email).toBe(user.user.email)
    expect(sessionStoreSelectors.getIsAuthenticated(sessionStore.state)).toBe(true)
  })
})
