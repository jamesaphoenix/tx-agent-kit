import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import BillingUsagePage from '@/app/(application)/org/[orgId]/billing/usage/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { resetIntegrationRouterLocation } from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderBillingUsagePage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <BillingUsagePage />
    </PathParamsContext.Provider>
  )
}

describe('BillingUsagePage integration', () => {
  it('shows an in-place usage skeleton on first load instead of a layout-shifting spinner', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-usage-skeleton-${randomUUID()}@example.com`,
      password: 'billing-usage-skeleton-pass-12345',
      name: 'Billing Usage Skeleton Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Usage Skeleton Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET subscription_status = 'active',
                 subscription_plan = 'pro',
                 stripe_customer_id = $1,
                 stripe_subscription_id = $2
           WHERE id = $3
        `,
        [`cus_${randomUUID()}`, `sub_${randomUUID()}`, organization.id]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/usage`)

    renderBillingUsagePage(organization.id)

    expect(screen.getByTestId('billing-usage-skeleton')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/category breakdown/i)).toBeInTheDocument()
    })
  })

  it('renders per-category usage summaries for an active subscription', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-usage-owner-${randomUUID()}@example.com`,
      password: 'billing-usage-owner-pass-12345',
      name: 'Billing Usage Owner'
})

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Usage Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET subscription_status = 'active',
                 subscription_plan = 'pro',
                 stripe_customer_id = $1,
                 stripe_subscription_id = $2
           WHERE id = $3
        `,
        [`cus_${randomUUID()}`, `sub_${randomUUID()}`, organization.id]
      )

      await client.query(
        `
          INSERT INTO usage_records (
            id,
            organization_id,
            category,
            quantity,
            unit_cost_decimillicents,
            total_cost_decimillicents,
            metadata,
            recorded_at,
            created_at
          )
          VALUES
            ($1, $3, 'api_call', 10, 10000000, 100000000, '{}'::jsonb, now(), now()),
            ($2, $3, 'text_generation', 2, 25000000, 50000000, '{}'::jsonb, now(), now())
        `,
        [randomUUID(), randomUUID(), organization.id]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/usage`)

    renderBillingUsagePage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /usage/i })).toBeInTheDocument()
      expect(screen.getByText(/api calls/i)).toBeInTheDocument()
      expect(screen.getByText(/text generation/i)).toBeInTheDocument()
      expect(screen.getAllByText('$15.00').length).toBeGreaterThan(0)
    }, { timeout: 15_000 })
  })

  it('keeps the monthly cap meter tied to current-month spend when switching report windows', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-usage-cap-${randomUUID()}@example.com`,
      password: 'billing-usage-cap-pass-12345',
      name: 'Billing Usage Cap Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Usage Cap Org'
    })

    const now = new Date()
    const olderThisMonth = new Date(now.getFullYear(), now.getMonth(), 2, 12, 0, 0)

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET subscription_status = 'active',
                 subscription_plan = 'pro',
                 stripe_customer_id = $1,
                 stripe_subscription_id = $2,
                 usage_cap = $4
           WHERE id = $3
        `,
        [`cus_${randomUUID()}`, `sub_${randomUUID()}`, organization.id, 200_000_000]
      )

      await client.query(
        `
          INSERT INTO usage_records (
            id,
            organization_id,
            category,
            quantity,
            unit_cost_decimillicents,
            total_cost_decimillicents,
            metadata,
            recorded_at,
            created_at
          )
          VALUES
            ($1, $3, 'api_call', 10, 10000000, 100000000, '{}'::jsonb, now(), now()),
            ($2, $3, 'text_generation', 1, 50000000, 50000000, '{}'::jsonb, $4, $4)
        `,
        [randomUUID(), randomUUID(), organization.id, olderThisMonth]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/usage`)

    const user = userEvent.setup()
    renderBillingUsagePage(organization.id)

    await waitFor(() => {
      expect(screen.getAllByText('$15.00').length).toBeGreaterThan(0)
      expect(screen.getByText(/75% of the cap consumed this month\./i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /last 7 days/i }))

    await waitFor(() => {
      expect(screen.getAllByText('$10.00').length).toBeGreaterThan(0)
      expect(screen.getByText(/75% of the cap consumed this month\./i)).toBeInTheDocument()
    })
  })

  it('shows the no-cap guidance when the organization has not set a monthly spend cap', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-usage-no-cap-${randomUUID()}@example.com`,
      password: 'billing-usage-no-cap-pass-12345',
      name: 'Billing Usage No Cap Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Usage No Cap Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET subscription_status = 'active',
                 subscription_plan = 'pro',
                 stripe_customer_id = $1,
                 stripe_subscription_id = $2,
                 usage_cap = NULL
           WHERE id = $3
        `,
        [`cus_${randomUUID()}`, `sub_${randomUUID()}`, organization.id]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/usage`)

    renderBillingUsagePage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/^No cap$/)).toBeInTheDocument()
      expect(screen.getByText(/set a cap in billing settings if you want a hard stop on spend/i)).toBeInTheDocument()
    })
  })

  it('shows the billing access guard to members without manage_billing permission', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-usage-owner-gate-${randomUUID()}@example.com`,
      password: 'billing-usage-owner-gate-pass-12345',
      name: 'Billing Usage Gate Owner'
    })
    const member = await createUser(factoryContext, {
      email: `billing-usage-member-${randomUUID()}@example.com`,
      password: 'billing-usage-member-pass-12345',
      name: 'Billing Usage Member'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Usage Gate Org'
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
    resetIntegrationRouterLocation(`/org/${organization.id}/billing/usage`)

    renderBillingUsagePage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/billing access required/i)).toBeInTheDocument()
      expect(screen.queryByText(/category breakdown/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /last 30 days/i })).not.toBeInTheDocument()
    })
  })
})
