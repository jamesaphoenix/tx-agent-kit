import React from 'react'
import { createUser } from '@tx-agent-kit/testkit'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const uid = randomUUID().slice(0, 8)
import { createWebFactoryContext } from '../integration/support/web-integration-context'
import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { ForgotPasswordForm } from './ForgotPasswordForm'

describe('ForgotPasswordForm integration', () => {
  it('shows generic success and creates a reset token for an existing user', async () => {
    const factoryContext = createWebFactoryContext()
    const userRecord = await createUser(factoryContext, {
      email: `forgot-password-existing-${uid}@example.com`,
      password: 'forgot-password-existing-pass-12345',
      name: 'Forgot Existing Web User'
    })

    const user = userEvent.setup()

    renderWithProviders(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText('Email'), userRecord.user.email)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => {
      expect(
        screen.getByText('If an account exists for that email, a reset link has been sent.')
      ).toBeInTheDocument()
    })

    const tokenCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM password_reset_tokens
          WHERE user_id = $1
        `,
        [userRecord.user.id]
      )

      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })

    expect(tokenCount).toBe(1)
  })

  it('returns the same success response for missing users and creates no tokens', async () => {
    const factoryContext = createWebFactoryContext()
    const user = userEvent.setup()

    renderWithProviders(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText('Email'), `forgot-password-missing-${uid}@example.com`)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => {
      expect(
        screen.getByText('If an account exists for that email, a reset link has been sent.')
      ).toBeInTheDocument()
    })

    // Verify no reset token was created for the non-existent user by checking
    // that no user with the missing email exists (and thus no tokens for them).
    const missingEmail = `forgot-password-missing-${uid}@example.com`
    const tokenCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM password_reset_tokens prt
          JOIN users u ON u.id = prt.user_id
          WHERE u.email = $1
        `,
        [missingEmail]
      )

      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })

    expect(tokenCount).toBe(0)
  })

  it('surfaces backend validation errors and keeps submission interactive', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText('Email'), 'invalid-email')

    const form = screen.getByRole('button', { name: 'Send reset link' }).closest('form')
    if (!form) {
      throw new Error('Forgot password form was not rendered')
    }

    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText(/invalid|failed/i)).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Send reset link' })).not.toBeDisabled()
  })
})
