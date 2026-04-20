import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import { AutoRechargeForm } from './AutoRechargeForm'

describe('AutoRechargeForm integration', () => {
  it('persists enabled auto-recharge settings', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-auto-recharge-${randomUUID()}@example.com`,
      password: 'billing-auto-recharge-pass-12345',
      name: 'Billing Auto Recharge Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Auto Recharge Org'
    })

    writeAuthToken(owner.token)
    const settings = await clientApi.getBillingSettings(organization.id)

    const user = userEvent.setup()
    renderWithProviders(
      <AutoRechargeForm organizationId={organization.id} settings={settings} />
    )

    await user.click(screen.getByRole('button', { name: /^enabled$/i }))
    await user.clear(screen.getByLabelText(/threshold \(usd\)/i))
    await user.type(screen.getByLabelText(/threshold \(usd\)/i), '15')
    await user.clear(screen.getByLabelText(/recharge amount \(usd\)/i))
    await user.type(screen.getByLabelText(/recharge amount \(usd\)/i), '45')
    await user.click(screen.getByRole('button', { name: /save auto-recharge/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.autoRechargeEnabled).toBe(true)
      expect(billing.autoRechargeThresholdDecimillicents).toBe(150_000_000)
      expect(billing.autoRechargeAmountDecimillicents).toBe(450_000_000)
    })
  })

  it('does not persist when enabled auto-recharge is missing a threshold or amount', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-auto-recharge-invalid-${randomUUID()}@example.com`,
      password: 'billing-auto-recharge-invalid-pass-12345',
      name: 'Billing Auto Recharge Invalid Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Auto Recharge Invalid Org'
    })

    writeAuthToken(owner.token)
    const settings = await clientApi.getBillingSettings(organization.id)

    const user = userEvent.setup()
    renderWithProviders(
      <AutoRechargeForm organizationId={organization.id} settings={settings} />
    )

    await user.click(screen.getByRole('button', { name: /^enabled$/i }))
    await user.clear(screen.getByLabelText(/threshold \(usd\)/i))
    await user.type(screen.getByLabelText(/threshold \(usd\)/i), '15')
    await user.clear(screen.getByLabelText(/recharge amount \(usd\)/i))
    await user.click(screen.getByRole('button', { name: /save auto-recharge/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.autoRechargeEnabled).toBe(false)
      expect(billing.autoRechargeThresholdDecimillicents).toBeNull()
      expect(billing.autoRechargeAmountDecimillicents).toBeNull()
    })
  })
})
