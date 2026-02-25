import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import ResetPasswordPage from './page'
import { resetIntegrationRouterLocation } from '../../integration/support/next-router-context'
import { renderWithProviders, screen, waitFor } from '../../integration/test-utils'

describe('ResetPasswordPage integration', () => {
  beforeEach(() => {
    resetIntegrationRouterLocation('/reset-password?token=query-token-value')
  })

  it('hydrates token from query params and keeps reset form enabled', async () => {
    renderWithProviders(<ResetPasswordPage />)

    await waitFor(() => {
      expect(screen.queryByText('Reset token is missing or invalid')).not.toBeInTheDocument()
    })

    expect(screen.getByLabelText('New password')).not.toBeDisabled()
    expect(screen.getByLabelText('Confirm password')).not.toBeDisabled()
  })
})
