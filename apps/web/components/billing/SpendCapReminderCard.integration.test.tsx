/**
 * Integration test for the Slice 13 onboarding spend cap reminder.
 *
 * Seeds an active-subscription org with no spend cap, mounts the
 * card, clicks a preset + save, and asserts the cap was persisted.
 * A second test seeds an org with a cap already set and asserts the
 * card is NOT rendered.
 *
 * @spec billing-and-pricing-design §"Onboarding" — spend cap opt-in
 */
import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { SpendCapReminderCard } from '@/components/billing/SpendCapReminderCard'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

/**
 * Billing settings writes are gated behind active subscription —
 * flip the org to Pro inside the test schema.
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

const setUsageCap = async (
  ctx: ReturnType<typeof createWebFactoryContext>,
  organizationId: string,
  capDecimillicents: number | null
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(`UPDATE organizations SET usage_cap = $1 WHERE id = $2`, [
      capDecimillicents,
      organizationId
    ])
  })
}

const readUsageCap = async (
  ctx: ReturnType<typeof createWebFactoryContext>,
  organizationId: string
): Promise<number | null> => {
  return ctx.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ usage_cap: string | null }>(
      `SELECT usage_cap FROM organizations WHERE id = $1`,
      [organizationId]
    )
    const raw = result.rows[0]?.usage_cap
    if (raw === null || raw === undefined) {
      return null
    }
    return Number(raw)
  })
}

describe('SpendCapReminderCard integration [spec: billing-and-pricing-design §"Onboarding"]', () => {
  it('lets the user pick a preset spend cap and persists it to the org', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `spend-cap-${randomUUID()}@example.com`,
      password: 'spend-cap-pass-12345',
      name: 'Spend Cap Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Spend Cap Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing`)
    await activateOrgSubscription(ctx, org.id)
    await setUsageCap(ctx, org.id, null)

    const user = userEvent.setup()
    renderWithProviders(<SpendCapReminderCard organizationId={org.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('spend-cap-reminder-card')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('spend-cap-preset-500'))
    await user.click(screen.getByTestId('spend-cap-save'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/spend cap set to \$500/i)
    })

    // Hit the DB to confirm the decimillicent write landed.
    const persisted = await readUsageCap(ctx, org.id)
    expect(persisted).toBe(500 * 10_000_000)
  })

  it('does not render when the org already has a usage cap set', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `spend-cap-existing-${randomUUID()}@example.com`,
      password: 'spend-cap-existing-pass-12345',
      name: 'Spend Cap Existing Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Spend Cap Existing Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing`)
    await activateOrgSubscription(ctx, org.id)
    // Seed a pre-existing $250 cap — the card should stay hidden.
    await setUsageCap(ctx, org.id, 250 * 10_000_000)

    renderWithProviders(<SpendCapReminderCard organizationId={org.id} />)

    // Give the query a tick to resolve.
    await waitFor(() => {
      expect(screen.queryByTestId('spend-cap-reminder-card')).toBeNull()
    })
  })

  it('hides the card when the user dismisses it without saving', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `spend-cap-dismiss-${randomUUID()}@example.com`,
      password: 'spend-cap-dismiss-pass-12345',
      name: 'Spend Cap Dismiss Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Spend Cap Dismiss Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing`)
    await activateOrgSubscription(ctx, org.id)
    await setUsageCap(ctx, org.id, null)

    const user = userEvent.setup()
    renderWithProviders(<SpendCapReminderCard organizationId={org.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('spend-cap-reminder-card')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('spend-cap-dismiss'))

    expect(screen.queryByTestId('spend-cap-reminder-card')).toBeNull()
    // Dismissal is client-only — the DB should still have no cap.
    expect(await readUsageCap(ctx, org.id)).toBeNull()
  })
})
