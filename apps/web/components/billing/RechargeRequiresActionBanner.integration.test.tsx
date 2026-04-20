/**
 * Integration test for the Slice 12 recharge requires-action banner.
 *
 * Seeds `organizations.payment_grace_period_ends_at` directly via SQL
 * on the shared factory context, mounts the banner, and asserts the
 * amber alert renders with the deadline and CTA. A second test with a
 * healthy org asserts the banner is NOT rendered.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — 3DS challenge
 */
import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { RechargeRequiresActionBanner } from '@/components/billing/RechargeRequiresActionBanner'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, waitFor } from '@/integration/test-utils'

/**
 * The billing settings endpoint is behind the active subscription
 * guard — flip the org to an active Pro subscription inside the test
 * schema so the banner can query its own state.
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

const setPaymentGracePeriod = async (
  ctx: ReturnType<typeof createWebFactoryContext>,
  organizationId: string,
  gracePeriodEndsAt: Date | null
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET payment_grace_period_ends_at = $1 WHERE id = $2`,
      [gracePeriodEndsAt ? gracePeriodEndsAt.toISOString() : null, organizationId]
    )
  })
}

describe('RechargeRequiresActionBanner integration [spec: billing-and-pricing-design §"UI Surfaces"]', () => {
  it('renders the amber banner with the deadline and CTA when the org is in grace period', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `recharge-action-${randomUUID()}@example.com`,
      password: 'recharge-action-pass-12345',
      name: 'Recharge Action Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Recharge Action Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing`)
    await activateOrgSubscription(ctx, org.id)
    // Grace period ends in 72h — simulates a failed auto-recharge
    // where Stripe asked for 3DS / additional verification.
    const deadline = new Date(Date.now() + 72 * 60 * 60 * 1000)
    await setPaymentGracePeriod(ctx, org.id, deadline)

    renderWithProviders(<RechargeRequiresActionBanner organizationId={org.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('recharge-requires-action-banner')).toBeInTheDocument()
    })
    expect(screen.getByText(/additional verification required/i)).toBeInTheDocument()
    expect(screen.getByTestId('recharge-requires-action-deadline')).toHaveTextContent(/\d/)
    expect(screen.getByTestId('recharge-requires-action-cta')).toHaveTextContent(
      /complete verification in stripe/i
    )
  })

  it('renders nothing when the org is healthy (no grace period set)', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `recharge-action-healthy-${randomUUID()}@example.com`,
      password: 'recharge-action-healthy-pass-12345',
      name: 'Recharge Action Healthy Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Recharge Action Healthy Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing`)
    await activateOrgSubscription(ctx, org.id)

    renderWithProviders(<RechargeRequiresActionBanner organizationId={org.id} />)

    // Give React Query a tick to resolve the settings query, then
    // assert the banner test id never appears. The component returns
    // null when there's no grace period, so no alert should be rendered.
    await waitFor(() => {
      expect(screen.queryByTestId('recharge-requires-action-banner')).toBeNull()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
