import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import { ThreeDSChallengeModal } from './ThreeDSChallengeModal'

describe('ThreeDSChallengeModal integration', () => {
  it('runs the confirmation flow and reports success', async () => {
    const confirmPayment = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const onSucceeded = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <ThreeDSChallengeModal
        open
        clientSecret="pi_test_secret_123"
        publishableKey="pk_test_123"
        confirmPayment={confirmPayment}
        onSucceeded={onSucceeded}
        onOpenChange={onOpenChange}
      />
    )

    await user.click(screen.getByRole('button', { name: /continue authentication/i }))

    await waitFor(() => {
      expect(confirmPayment).toHaveBeenCalledWith('pi_test_secret_123')
      expect(onSucceeded).toHaveBeenCalledTimes(1)
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('surfaces the failure reason and keeps the modal open when confirmation fails', async () => {
    const confirmPayment = vi.fn().mockResolvedValue({
      status: 'failed',
      error: 'Authentication failed'
    })
    const onSucceeded = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <ThreeDSChallengeModal
        open
        clientSecret="pi_test_secret_456"
        publishableKey="pk_test_123"
        confirmPayment={confirmPayment}
        onSucceeded={onSucceeded}
        onOpenChange={onOpenChange}
      />
    )

    await user.click(screen.getByRole('button', { name: /continue authentication/i }))

    await waitFor(() => {
      expect(screen.getByText(/authentication failed/i)).toBeInTheDocument()
      expect(onSucceeded).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })
  })
})
