/**
 * Integration test for the Slice 10 usage breakdown card.
 *
 * Seeds usage_records rows for text / image / video / storage
 * categories, mounts the card, and asserts each per-category total
 * + the combined total render correctly.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — usage dashboard
 */
import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { UsageBreakdownCard } from '@/components/billing/UsageBreakdownCard'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, waitFor } from '@/integration/test-utils'

interface UsageSeed {
  readonly category: 'text_generation' | 'image_generation' | 'video_generation' | 'storage'
  readonly totalCostDecimillicents: number
}

/**
 * The usage summary endpoint is behind the "active subscription" guard
 * — unsubscribed orgs get a 401 "Active subscription required". Flip
 * the org into an active Pro subscription inside the test schema so
 * the UI component can actually read its own usage.
 */
const activateOrgSubscription = async (
  ctx: ReturnType<typeof createWebFactoryContext>,
  organizationId: string
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations
          SET is_subscribed = true,
              subscription_status = 'active',
              subscription_plan = 'pro'
        WHERE id = $1`,
      [organizationId]
    )
  })
}

const seedUsage = async (
  ctx: ReturnType<typeof createWebFactoryContext>,
  organizationId: string,
  rows: ReadonlyArray<UsageSeed>
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    for (const row of rows) {
      await client.query(
        `INSERT INTO usage_records
            (id, organization_id, category, quantity,
             unit_cost_decimillicents, total_cost_decimillicents,
             metadata, recorded_at, created_at)
          VALUES ($1, $2, $3, 1, $4, $4, '{}'::jsonb, now(), now())`,
        [
          randomUUID(),
          organizationId,
          row.category,
          row.totalCostDecimillicents
        ]
      )
    }
  })
}

describe('UsageBreakdownCard integration [spec: billing-and-pricing-design §"UI Surfaces"]', () => {
  it('renders per-category totals and a combined total across all four rows', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `usage-card-${randomUUID()}@example.com`,
      password: 'usage-card-pass-12345',
      name: 'Usage Card Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Usage Card Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing/usage`)
    await activateOrgSubscription(ctx, org.id)

    await seedUsage(ctx, org.id, [
      { category: 'text_generation', totalCostDecimillicents: 15_000_000 }, // $1.50
      { category: 'image_generation', totalCostDecimillicents: 30_000_000 }, // $3.00
      { category: 'video_generation', totalCostDecimillicents: 80_000_000 }, // $8.00
      { category: 'storage', totalCostDecimillicents: 5_000_000 } // $0.50
    ])

    renderWithProviders(<UsageBreakdownCard organizationId={org.id} />)

    // All four queries fire in parallel — wait until each row has
    // resolved from "Loading…" to its dollar total, and the combined
    // footer reflects the sum.
    await waitFor(() => {
      expect(screen.getByTestId('usage-row-text')).toHaveTextContent('$1.50')
      expect(screen.getByTestId('usage-row-image')).toHaveTextContent('$3.00')
      expect(screen.getByTestId('usage-row-video')).toHaveTextContent('$8.00')
      expect(screen.getByTestId('usage-row-storage')).toHaveTextContent('$0.50')
      // Combined total: 1.50 + 3.00 + 8.00 + 0.50 = $13.00.
      expect(screen.getByTestId('usage-row-total')).toHaveTextContent('$13.00')
    })
  })

  it('renders $0.00 totals when there are no usage records for the org', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `usage-card-empty-${randomUUID()}@example.com`,
      password: 'usage-card-empty-pass-12345',
      name: 'Usage Card Empty Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Usage Card Empty Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing/usage`)
    await activateOrgSubscription(ctx, org.id)

    renderWithProviders(<UsageBreakdownCard organizationId={org.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('usage-row-text')).toHaveTextContent('$0.00')
      expect(screen.getByTestId('usage-row-image')).toHaveTextContent('$0.00')
      expect(screen.getByTestId('usage-row-video')).toHaveTextContent('$0.00')
      expect(screen.getByTestId('usage-row-storage')).toHaveTextContent('$0.00')
      expect(screen.getByTestId('usage-row-total')).toHaveTextContent('$0.00')
    })
  })
})
