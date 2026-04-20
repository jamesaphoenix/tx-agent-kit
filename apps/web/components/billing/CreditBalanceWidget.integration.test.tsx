/**
 * Integration test for the Slice 8 credit balance widget.
 *
 * Seeds an org with a specific credit balance via the testkit, renders
 * the widget wrapped in `PathParamsContext`, and asserts the displayed
 * figures match. Top-up behavior is covered by TopUpDialog integration tests.
 *
 * @spec billing-and-pricing-design §"UI Surfaces"
 */
import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser, seedOrgCredits } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { CreditBalanceWidget } from '@/components/billing/CreditBalanceWidget'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, waitFor } from '@/integration/test-utils'

const renderWidget = (orgId: string) =>
  renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <CreditBalanceWidget organizationId={orgId} />
    </PathParamsContext.Provider>
  )

describe('CreditBalanceWidget integration [spec: billing-and-pricing-design §"UI Surfaces"]', () => {
  it('renders the available balance in USD for a seeded org', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `credit-widget-${randomUUID()}@example.com`,
      password: 'credit-widget-pass-12345',
      name: 'Credit Widget Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Credit Widget Org'
    })
    // Seed 12,300,000 decimillicents = $1.23
    await seedOrgCredits(ctx, org.id, 12_300_000)

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing`)
    renderWidget(org.id)

    // Wait for the balance query to resolve.
    await waitFor(() => {
      expect(screen.getByLabelText('Available balance')).toHaveTextContent('$1.23')
    })
    // Total balance + reserved fields also render.
    expect(screen.getAllByText(/\$1\.23/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByLabelText('Reserved credits')).toHaveTextContent('$0.00')
  })

  it('renders a suspended status when the organization is suspended', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `credit-widget-suspended-${randomUUID()}@example.com`,
      password: 'credit-widget-suspended-pass-12345',
      name: 'Credit Widget Suspended Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Credit Widget Suspended Org'
    })
    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET suspended_at = now()
           WHERE id = $1
        `,
        [org.id]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing`)
    renderWidget(org.id)

    await waitFor(() => {
      expect(screen.getByText('Suspended')).toBeInTheDocument()
    })
  })
})
