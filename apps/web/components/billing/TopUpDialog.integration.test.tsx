import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import { TopUpDialog } from './TopUpDialog'

describe('TopUpDialog integration', () => {
  it('requires confirmation before opening Stripe checkout for a credit top-up', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-top-up-confirm-${randomUUID()}@example.com`,
      password: 'billing-top-up-confirm-pass-12345',
      name: 'Billing Top Up Confirm Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Top Up Confirm Org'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderWithProviders(<TopUpDialog organizationId={organization.id} defaultAmountDollars="25" />)

    await user.click(screen.getByRole('button', { name: /top up credits/i }))
    await user.click(await screen.findByRole('button', { name: /continue to stripe/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /confirm credit top-up/i })).toBeInTheDocument()
      expect(screen.getByText(/\$25\.00/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /confirm top-up/i })).toBeInTheDocument()
    })
  })
})
