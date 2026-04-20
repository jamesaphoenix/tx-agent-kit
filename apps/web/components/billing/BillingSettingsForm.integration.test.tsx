/**
 * Integration test for the Slice 11 billing settings form.
 *
 * Seeds an org with specific auto-recharge/spend-cap defaults via
 * direct SQL through the shared factory context, mounts the form,
 * asserts the initial state, flips auto-recharge on + sets threshold
 * and amount, clicks Save, and confirms the settings roundtripped by
 * asserting the success banner and the re-rendered form values.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — billing settings
 */
import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { BillingSettingsForm } from '@/components/billing/BillingSettingsForm'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

/**
 * The billing settings read/write endpoints are behind the active
 * subscription guard — flip the org to an active Pro subscription
 * inside the test schema so the form can load its own state.
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

const seedAutoRechargeState = async (
  ctx: ReturnType<typeof createWebFactoryContext>,
  organizationId: string,
  row: {
    readonly autoRechargeEnabled: boolean
    readonly autoRechargeThresholdDecimillicents: number | null
    readonly autoRechargeAmountDecimillicents: number | null
    readonly usageCapDecimillicents: number | null
  }
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations
          SET auto_recharge_enabled = $1,
              auto_recharge_threshold = $2,
              auto_recharge_amount = $3,
              usage_cap = $4
        WHERE id = $5`,
      [
        row.autoRechargeEnabled,
        row.autoRechargeThresholdDecimillicents,
        row.autoRechargeAmountDecimillicents,
        row.usageCapDecimillicents,
        organizationId
      ]
    )
  })
}

describe('BillingSettingsForm integration [spec: billing-and-pricing-design §"UI Surfaces"]', () => {
  it('loads the seeded auto-recharge + spend cap values on mount', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `billing-settings-${randomUUID()}@example.com`,
      password: 'billing-settings-pass-12345',
      name: 'Billing Settings Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Billing Settings Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing/settings`)
    await activateOrgSubscription(ctx, org.id)
    await seedAutoRechargeState(ctx, org.id, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 100_000_000, // $10
      autoRechargeAmountDecimillicents: 500_000_000, // $50
      usageCapDecimillicents: 2_000_000_000 // $200
    })

    renderWithProviders(<BillingSettingsForm organizationId={org.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('billing-settings-form')).toBeInTheDocument()
    })

    // Plan label reflects the seeded Pro subscription.
    expect(screen.getByTestId('billing-settings-plan')).toHaveTextContent('Pro')

    // Dollar-denominated inputs reflect the seeded decimillicent values.
    const thresholdInput = screen.getByTestId<HTMLInputElement>('billing-settings-threshold')
    expect(thresholdInput.value).toBe('10')
    const amountInput = screen.getByTestId<HTMLInputElement>('billing-settings-amount')
    expect(amountInput.value).toBe('50')
    const usageCapInput = screen.getByTestId<HTMLInputElement>('billing-settings-usage-cap')
    expect(usageCapInput.value).toBe('200')

    const toggle = screen.getByTestId<HTMLInputElement>('billing-settings-auto-recharge-toggle')
    expect(toggle.checked).toBe(true)
  })

  it('saves a toggled-on auto-recharge state and surfaces the success banner', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `billing-settings-save-${randomUUID()}@example.com`,
      password: 'billing-settings-save-pass-12345',
      name: 'Billing Settings Save Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Billing Settings Save Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing/settings`)
    await activateOrgSubscription(ctx, org.id)
    // Start with auto-recharge OFF and no cap.
    await seedAutoRechargeState(ctx, org.id, {
      autoRechargeEnabled: false,
      autoRechargeThresholdDecimillicents: null,
      autoRechargeAmountDecimillicents: null,
      usageCapDecimillicents: null
    })

    const user = userEvent.setup()
    renderWithProviders(<BillingSettingsForm organizationId={org.id} />)

    await waitFor(() => {
      expect(screen.getByTestId('billing-settings-form')).toBeInTheDocument()
    })

    const toggle = screen.getByTestId<HTMLInputElement>('billing-settings-auto-recharge-toggle')
    expect(toggle.checked).toBe(false)
    await user.click(toggle)
    expect(toggle.checked).toBe(true)

    const thresholdInput = screen.getByTestId<HTMLInputElement>('billing-settings-threshold')
    await user.clear(thresholdInput)
    await user.type(thresholdInput, '15')
    const amountInput = screen.getByTestId<HTMLInputElement>('billing-settings-amount')
    await user.clear(amountInput)
    await user.type(amountInput, '75')

    await user.click(screen.getByTestId('billing-settings-save'))

    // Status banner + refetched values confirm the PATCH roundtripped.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/settings saved/i)
    })
    expect(toggle.checked).toBe(true)
    expect((screen.getByTestId<HTMLInputElement>('billing-settings-threshold')).value).toBe('15')
    expect((screen.getByTestId<HTMLInputElement>('billing-settings-amount')).value).toBe('75')
  })
})
