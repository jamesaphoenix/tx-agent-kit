import React from 'react'
import { clearAuthToken, readAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser } from '@tx-agent-kit/testkit'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'

const uid = randomUUID().slice(0, 8)
import { AuthForm } from './AuthForm'
import { readIntegrationRouterLocation } from '../integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

/** Retry an async factory call to tolerate transient server availability gaps. */
const withRetry = async <T,>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const isFetchError = error instanceof TypeError && /fetch failed/i.test(error.message)
      if (!isFetchError || attempt === retries - 1) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }
  throw new Error('withRetry exhausted')
}

describe('AuthForm integration', () => {
  beforeEach(() => { clearAuthToken() })

  it('signs up a new user and persists auth token', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AuthForm mode="sign-up" nextPath="/dashboard" />)

    await user.type(screen.getByLabelText('Name'), 'Integration User')
    await user.type(screen.getByLabelText('Email'), `web-sign-up-${uid}@example.com`)
    await user.type(screen.getByLabelText('Password'), 'strong-pass-12345')

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/dashboard')
    })

    const token = readAuthToken()
    expect(token).toBeTruthy()

    const principal = await clientApi.me()
    expect(principal.email).toBe(`web-sign-up-${uid}@example.com`)
  })

  it('shows an error when sign-up email is already in use', async () => {
    const factoryContext = createWebFactoryContext()
    const existing = await withRetry(() => createUser(factoryContext, {
      email: `web-sign-up-dup-${uid}@example.com`,
      password: 'existing-pass-12345',
      name: 'Existing Sign Up User'
    }))

    // Clear any token from previous tests or createUser
    clearAuthToken()

    const user = userEvent.setup()

    renderWithProviders(<AuthForm mode="sign-up" nextPath="/dashboard" />)

    await user.type(screen.getByLabelText('Name'), 'Duplicate User')
    await user.type(screen.getByLabelText('Email'), existing.credentials.email)
    await user.type(screen.getByLabelText('Password'), 'strong-pass-12345')

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(
        screen.getByText(/email is already in use|already|failed|conflict|sign.?up|unauthorized|duplicate/i)
      ).toBeInTheDocument()
    })

    expect(readIntegrationRouterLocation().pathname).not.toBe('/dashboard')
  })

  it('signs in an existing user', async () => {
    const factoryContext = createWebFactoryContext()
    const created = await withRetry(() => createUser(factoryContext, {
      email: `web-sign-in-${uid}@example.com`,
      password: 'sign-in-pass-12345',
      name: 'Sign In User'
    }))

    const user = userEvent.setup()

    renderWithProviders(<AuthForm mode="sign-in" nextPath="/organizations" />)

    await user.type(screen.getByLabelText('Email'), created.credentials.email)
    await user.type(screen.getByLabelText('Password'), created.credentials.password)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/organizations')
    })

    const principal = await clientApi.me()
    expect(principal.email).toBe(created.credentials.email)
  })

  it('surfaces an error when sign-in credentials are invalid', async () => {
    const factoryContext = createWebFactoryContext()
    const created = await withRetry(() => createUser(factoryContext, {
      email: `web-sign-in-invalid-${uid}@example.com`,
      password: 'valid-pass-12345',
      name: 'Invalid Sign In User'
    }))

    // Clear any token — capture state before form submission
    clearAuthToken()

    const user = userEvent.setup()

    renderWithProviders(<AuthForm mode="sign-in" nextPath="/organizations" />)

    await user.type(screen.getByLabelText('Email'), created.credentials.email)
    await user.type(screen.getByLabelText('Password'), 'wrong-pass-12345')

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    })

    expect(readIntegrationRouterLocation().pathname).not.toBe('/organizations')
  })
})
