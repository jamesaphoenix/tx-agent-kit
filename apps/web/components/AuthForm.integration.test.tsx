import React from 'react'
import { readAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { AuthForm } from './AuthForm'
import { mockRouter } from '../integration/mocks/next-navigation'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

describe('AuthForm integration', () => {
  it('signs up a new user and persists auth token', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AuthForm mode="sign-up" nextPath="/dashboard" />)

    await user.type(screen.getByLabelText('Name'), 'Integration User')
    await user.type(screen.getByLabelText('Email'), 'web-sign-up@example.com')
    await user.type(screen.getByLabelText('Password'), 'strong-pass-12345')

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/dashboard')
    })

    const token = readAuthToken()
    expect(token).toBeTruthy()

    const principal = await clientApi.me()
    expect(principal.email).toBe('web-sign-up@example.com')
  })

  it('signs in an existing user', async () => {
    const factoryContext = createWebFactoryContext()
    const created = await createUser(factoryContext, {
      email: 'web-sign-in@example.com',
      password: 'sign-in-pass-12345',
      name: 'Sign In User'
    })

    const user = userEvent.setup()

    renderWithProviders(<AuthForm mode="sign-in" nextPath="/workspaces" />)

    await user.type(screen.getByLabelText('Email'), created.credentials.email)
    await user.type(screen.getByLabelText('Password'), created.credentials.password)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/workspaces')
    })

    const principal = await clientApi.me()
    expect(principal.email).toBe(created.credentials.email)
  })
})
