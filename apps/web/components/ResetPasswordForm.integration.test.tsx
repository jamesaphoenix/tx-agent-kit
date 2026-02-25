import React from 'react'
import { createHash } from 'node:crypto'
import { createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { readIntegrationRouterLocation } from '../integration/support/next-router-context'
import { createWebFactoryContext } from '../integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { ResetPasswordForm } from './ResetPasswordForm'

describe('ResetPasswordForm integration', () => {
  it('requires a valid token', () => {
    renderWithProviders(<ResetPasswordForm token={null} />)

    expect(screen.getByText('Reset token is missing or invalid')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled()
  })

  it('resets password and redirects to sign-in', async () => {
    const factoryContext = createWebFactoryContext()
    const created = await createUser(factoryContext, {
      email: 'reset-password-form@example.com',
      password: 'reset-password-old-12345',
      name: 'Reset Password Form User'
    })

    const rawToken = 'web-integration-reset-token'
    const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex')

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES ($1, $2, now() + interval '30 minutes')
        `,
        [created.user.id, tokenHash]
      )
    })

    const user = userEvent.setup()

    renderWithProviders(<ResetPasswordForm token={rawToken} />)

    await user.type(screen.getByLabelText('New password'), 'reset-password-new-12345')
    await user.type(screen.getByLabelText('Confirm password'), 'reset-password-new-12345')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/sign-in')
    })

    const oldPasswordSignIn = await fetch(`${factoryContext.baseUrl}/v1/auth/sign-in`, {
      method: 'POST',
      headers: factoryContext.testContext.headersForCase('web-reset-form-old-password-sign-in', {
        'content-type': 'application/json'
      }),
      body: JSON.stringify({
        email: created.user.email,
        password: 'reset-password-old-12345'
      })
    })

    expect(oldPasswordSignIn.status).toBe(401)

    const newPasswordSignIn = await fetch(`${factoryContext.baseUrl}/v1/auth/sign-in`, {
      method: 'POST',
      headers: factoryContext.testContext.headersForCase('web-reset-form-new-password-sign-in', {
        'content-type': 'application/json'
      }),
      body: JSON.stringify({
        email: created.user.email,
        password: 'reset-password-new-12345'
      })
    })

    expect(newPasswordSignIn.status).toBe(200)
  })

  it('shows an error and does not redirect when token is invalid or expired', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ResetPasswordForm token="invalid-token-from-link" />)

    await user.type(screen.getByLabelText('New password'), 'reset-password-new-12345')
    await user.type(screen.getByLabelText('Confirm password'), 'reset-password-new-12345')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => {
      expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument()
    })

    expect(readIntegrationRouterLocation().pathname).not.toBe('/sign-in')
    expect(screen.getByRole('button', { name: 'Update password' })).not.toBeDisabled()
  })
})
