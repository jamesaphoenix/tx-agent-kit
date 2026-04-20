import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import BillingSettingsPage from '@/app/(application)/org/[orgId]/billing/settings/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { resetIntegrationRouterLocation } from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderBillingSettingsPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <BillingSettingsPage />
    </PathParamsContext.Provider>
  )
}

describe('BillingSettingsPage integration', () => {
  it('renders the dedicated billing settings route for org admins', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-settings-owner-${randomUUID()}@example.com`,
      password: 'billing-settings-owner-pass-12345',
      name: 'Billing Settings Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Settings Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/settings`)

    renderBillingSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /billing settings/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save spend cap/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /no cap/i })).toBeInTheDocument()
    })
  })

  it('persists the monthly spend cap through the billing settings form', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-settings-cap-owner-${randomUUID()}@example.com`,
      password: 'billing-settings-cap-pass-12345',
      name: 'Billing Spend Cap Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Spend Cap Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/settings`)

    const user = userEvent.setup()
    renderBillingSettingsPage(organization.id)

    await user.click(await screen.findByRole('button', { name: /custom/i }))
    const capInput = await screen.findByLabelText(/monthly spend cap/i)
    await waitFor(() => {
      expect((capInput as HTMLInputElement).value).toBe('')
    })

    await user.type(capInput, '125')
    await user.click(screen.getByRole('button', { name: /save spend cap/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.usageCapDecimillicents).toBe(1_250_000_000)
    })
  })

  it('shows recent welcome credit history directly on the billing settings page', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-settings-history-${randomUUID()}@example.com`,
      password: 'billing-settings-history-pass-12345',
      name: 'Billing Welcome Credit Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Welcome Credit Org'
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
          VALUES (
            $1,
            $2,
            'purchase',
            200000000,
            'Welcome credit',
            'welcome-credit',
            '{}'::jsonb,
            200000000,
            now()
          )
        `,
        [randomUUID(), organization.id]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/settings`)

    renderBillingSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/welcome credit history/i)).toBeInTheDocument()
      expect(screen.getByText(/^Welcome credit$/)).toBeInTheDocument()
      expect(screen.getByText(/^\$20\.00$/)).toBeInTheDocument()
    })
  })

  it('shows the billing access guard to members without manage_billing permission', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-settings-owner-gate-${randomUUID()}@example.com`,
      password: 'billing-settings-owner-gate-pass-12345',
      name: 'Billing Settings Gate Owner'
    })
    const member = await createUser(factoryContext, {
      email: `billing-settings-member-${randomUUID()}@example.com`,
      password: 'billing-settings-member-pass-12345',
      name: 'Billing Settings Member'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Settings Gate Org'
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
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/settings`)

    renderBillingSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/billing access required/i)).toBeInTheDocument()
      expect(screen.queryByText(/billing contact/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /save billing contact/i })).not.toBeInTheDocument()
    })
  })
})
