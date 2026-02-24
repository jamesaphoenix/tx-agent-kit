import { randomUUID } from 'node:crypto'
import {
  createUser
} from '../../../packages/testkit/src/index.ts'
import { createMobileFactoryContext } from '../integration/support/mobile-integration-context'
import { readAuthToken } from './auth-token'
import { describe, expect, it, vi } from 'vitest'

const loadClientApi = async () => import('./client-api')

describe('mobile client API integration', () => {
  it('signs up and resolves the authenticated principal against a real API harness', async () => {
    vi.resetModules()
    const { clientApi } = await loadClientApi()
    const email = `mobile-int-${randomUUID()}@example.com`

    await clientApi.signUp({
      email,
      password: 'strong-pass-12345',
      name: 'Mobile Integration User'
    })

    const persistedToken = await readAuthToken()
    expect(persistedToken).toBeTruthy()

    const principal = await clientApi.me()
    expect(principal.email).toBe(email)
  })

  it('signs in an existing user and can fetch me with persisted token state', async () => {
    const seededUser = await createUser(createMobileFactoryContext(), {
      email: `mobile-signin-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Sign In User'
    })

    vi.resetModules()
    const { clientApi } = await loadClientApi()

    await clientApi.signIn({
      email: seededUser.credentials.email,
      password: seededUser.credentials.password
    })

    const persistedToken = await readAuthToken()
    expect(persistedToken).toBeTruthy()

    const principal = await clientApi.me()
    expect(principal.userId).toBe(seededUser.user.id)
    expect(principal.email).toBe(seededUser.user.email)

    await clientApi.signOut()
    const clearedToken = await readAuthToken()
    expect(clearedToken).toBeNull()
  })
})
