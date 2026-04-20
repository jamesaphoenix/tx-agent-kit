import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import { SpendCapStep } from './SpendCapStep'

describe('SpendCapStep integration', () => {
  it('persists the selected spend cap and continues', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-spend-cap-${randomUUID()}@example.com`,
      password: 'billing-spend-cap-pass-12345',
      name: 'Billing Spend Cap Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Spend Cap Org'
    })

    writeAuthToken(owner.token)

    const onContinue = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <SpendCapStep organizationId={organization.id} onContinue={onContinue} />
    )

    await user.click(await screen.findByRole('button', { name: '$250' }))
    await user.click(screen.getByRole('button', { name: /set cap and continue/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.usageCapDecimillicents).toBe(2_500_000_000)
    })

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledTimes(1)
    })
  })

  it('clears any existing cap when the user skips for now', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-spend-cap-skip-${randomUUID()}@example.com`,
      password: 'billing-spend-cap-skip-pass-12345',
      name: 'Billing Spend Cap Skip Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Spend Cap Skip Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations
            SET usage_cap = $2,
                updated_at = now()
          WHERE id = $1`,
        [organization.id, 500_000_000]
      )
    })

    writeAuthToken(owner.token)

    const onContinue = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <SpendCapStep organizationId={organization.id} onContinue={onContinue} />
    )

    await user.click(await screen.findByRole('button', { name: /skip for now/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.usageCapDecimillicents).toBeNull()
    })

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledTimes(1)
    })
  })

  it('lets the user explicitly choose no cap and continue', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-spend-cap-none-${randomUUID()}@example.com`,
      password: 'billing-spend-cap-none-pass-12345',
      name: 'Billing Spend Cap None Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Spend Cap None Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations
            SET usage_cap = $2,
                updated_at = now()
          WHERE id = $1`,
        [organization.id, 1_000_000_000]
      )
    })

    writeAuthToken(owner.token)

    const onContinue = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <SpendCapStep organizationId={organization.id} onContinue={onContinue} />
    )

    await user.click(await screen.findByRole('button', { name: /^no cap$/i }))
    await user.click(screen.getByRole('button', { name: /set cap and continue/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.usageCapDecimillicents).toBeNull()
    })

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledTimes(1)
    })
  })

  it('rejects a custom spend cap outside the allowed bounds', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-spend-cap-bounds-${randomUUID()}@example.com`,
      password: 'billing-spend-cap-bounds-pass-12345',
      name: 'Billing Spend Cap Bounds Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Spend Cap Bounds Org'
    })

    writeAuthToken(owner.token)

    const onContinue = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <SpendCapStep organizationId={organization.id} onContinue={onContinue} />
    )

    await user.click(await screen.findByRole('button', { name: /custom/i }))
    await user.type(await screen.findByLabelText(/custom monthly cap/i), '0')
    await user.click(screen.getByRole('button', { name: /set cap and continue/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.usageCapDecimillicents).toBeNull()
    })

    expect(onContinue).not.toHaveBeenCalled()
  })
})
