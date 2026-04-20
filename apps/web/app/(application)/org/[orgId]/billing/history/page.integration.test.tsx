import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import BillingHistoryPage from '@/app/(application)/org/[orgId]/billing/history/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { resetIntegrationRouterLocation } from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderBillingHistoryPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <BillingHistoryPage />
    </PathParamsContext.Provider>
  )
}

describe('BillingHistoryPage integration', () => {
  it('renders ledger entries from the credit history endpoint', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-history-owner-${randomUUID()}@example.com`,
      password: 'billing-history-owner-pass-12345',
      name: 'Billing History Owner'
})

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing History Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO credit_ledger (
            id,
            organization_id,
            entry_type,
            amount_decimillicents,
            reason,
            reference_id,
            metadata,
            balance_after,
            created_at
          )
          VALUES
            ($1, $2, 'purchase', 200000000, 'Welcome credit', 'welcome-credit', '{}'::jsonb, 200000000, now() - interval '1 minute'),
            ($3, $2, 'usage', -50000000, 'Image generation', 'usage-asset-1', '{}'::jsonb, 150000000, now())
        `,
        [randomUUID(), organization.id, randomUUID()]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/history`)

    renderBillingHistoryPage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /credit history/i })).toBeInTheDocument()
      expect(screen.getByText('Image generation')).toBeInTheDocument()
      expect(screen.getByText(/-\$5\.00/)).toBeInTheDocument()
      expect(screen.getByText('Welcome credit')).toBeInTheDocument()
    })
  })

  it('paginates through ledger history and lets the user return to the previous page', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-history-pagination-${randomUUID()}@example.com`,
      password: 'billing-history-pagination-pass-12345',
      name: 'Billing History Pagination Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing History Pagination Org'
    })

    const user = userEvent.setup()

    await factoryContext.testContext.withSchemaClient(async (client) => {
      for (let index = 0; index < 21; index += 1) {
        const label = `Ledger entry ${String(index + 1).padStart(2, '0')}`
        await client.query(
          `
            INSERT INTO credit_ledger (
              id,
              organization_id,
              entry_type,
              amount_decimillicents,
              reason,
              reference_id,
              metadata,
              balance_after,
              created_at
            )
            VALUES ($1, $2, 'usage', -1000000, $3, $4, '{}'::jsonb, 100000000, now() - ($5 * interval '1 minute'))
          `,
          [randomUUID(), organization.id, label, `ref-${index.toString()}`, index]
        )
      }
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/history`)

    renderBillingHistoryPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText('Ledger entry 01')).toBeInTheDocument()
      expect(screen.queryByText('Ledger entry 21')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /next page/i })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /next page/i }))

    await waitFor(() => {
      expect(screen.getByText('Ledger entry 21')).toBeInTheDocument()
      expect(screen.queryByText('Ledger entry 01')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /previous page/i })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /previous page/i }))

    await waitFor(() => {
      expect(screen.getByText('Ledger entry 01')).toBeInTheDocument()
      expect(screen.queryByText('Ledger entry 21')).not.toBeInTheDocument()
    })
  })

  it('shows the billing access guard to members without manage_billing permission', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-history-owner-gate-${randomUUID()}@example.com`,
      password: 'billing-history-owner-gate-pass-12345',
      name: 'Billing History Gate Owner'
    })
    const member = await createUser(factoryContext, {
      email: `billing-history-member-${randomUUID()}@example.com`,
      password: 'billing-history-member-pass-12345',
      name: 'Billing History Member'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing History Gate Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (organization_id, user_id) DO NOTHING
        `,
        [organization.id, member.user.id]
      )
    })

    writeAuthToken(member.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/history`)

    renderBillingHistoryPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/billing access required/i)).toBeInTheDocument()
      expect(screen.queryByText(/ledger entries/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument()
    })
  })
})
