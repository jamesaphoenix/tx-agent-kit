import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import BillingPlansPage, {
  resolveCheckoutSuccessPath
} from '@/app/(application)/org/[orgId]/billing/plans/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { resetIntegrationRouterLocation } from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderBillingPlansPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <BillingPlansPage />
    </PathParamsContext.Provider>
  )
}

describe('BillingPlansPage integration', () => {
  it('renders plan cards and highlights the current subscription', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-plans-owner-${randomUUID()}@example.com`,
      password: 'billing-plans-owner-pass-12345',
      name: 'Billing Plans Owner'
})

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Plans Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET subscription_status = 'active',
                 subscription_plan = 'pro'
           WHERE id = $1
        `,
        [organization.id]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/plans`)

    renderBillingPlansPage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /plans/i })).toBeInTheDocument()
      expect(screen.getByText('Try Me')).toBeInTheDocument()
      expect(screen.getByText('Pro')).toBeInTheDocument()
      expect(screen.getByText('Agency')).toBeInTheDocument()
      expect(screen.getAllByText('Current').length).toBeGreaterThan(0)
    })
  })

  it('routes first-time subscription checkout success through the welcome onboarding page', () => {
    expect(resolveCheckoutSuccessPath('org_123', null)).toBe('/org/org_123/onboarding/welcome')
  })

  it('routes existing subscribers back to billing after checkout', () => {
    expect(resolveCheckoutSuccessPath('org_123', 'pro')).toBe('/org/org_123/billing')
  })

  it('requires explicit confirmation before opening checkout for a different plan', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-plans-confirm-${randomUUID()}@example.com`,
      password: 'billing-plans-confirm-pass-12345',
      name: 'Billing Plans Confirm Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Plans Confirm Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET subscription_status = 'active',
                 subscription_plan = 'pro'
           WHERE id = $1
        `,
        [organization.id]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/plans`)

    const user = userEvent.setup()
    renderBillingPlansPage(organization.id)

    await user.click(await screen.findByRole('button', { name: /choose agency/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /confirm plan change/i })).toBeInTheDocument()
      expect(screen.getByText(/open stripe checkout for the agency plan/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /confirm plan change/i })).toBeInTheDocument()
    })
  })

  it('shows the billing access guard to members without manage_billing permission', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-plans-owner-gate-${randomUUID()}@example.com`,
      password: 'billing-plans-owner-gate-pass-12345',
      name: 'Billing Plans Gate Owner'
    })
    const member = await createUser(factoryContext, {
      email: `billing-plans-member-${randomUUID()}@example.com`,
      password: 'billing-plans-member-pass-12345',
      name: 'Billing Plans Member'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Plans Gate Org'
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
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/plans`)

    renderBillingPlansPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/billing access required/i)).toBeInTheDocument()
      expect(screen.queryByText('Try Me')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /choose agency/i })).not.toBeInTheDocument()
    })
  })
})
