import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, waitFor } from '@/integration/test-utils'
import { GracePeriodBanner } from './GracePeriodBanner'

describe('GracePeriodBanner integration', () => {
  it('does not render when the organization has no payment grace period', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-grace-healthy-${randomUUID()}@example.com`,
      password: 'billing-grace-healthy-pass-12345',
      name: 'Billing Grace Healthy Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Grace Healthy Org'
    })

    writeAuthToken(owner.token)

    renderWithProviders(<GracePeriodBanner organizationId={organization.id} />)

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('renders a payment-required warning when the grace period is active', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-grace-active-${randomUUID()}@example.com`,
      password: 'billing-grace-active-pass-12345',
      name: 'Billing Grace Active Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Grace Active Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations
            SET payment_grace_period_ends_at = $2,
                stripe_customer_id = $3,
                updated_at = now()
          WHERE id = $1`,
        [
          organization.id,
          new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          `cus_grace_banner_${randomUUID()}`
        ]
      )
    })

    writeAuthToken(owner.token)

    renderWithProviders(<GracePeriodBanner organizationId={organization.id} />)

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/payment required/i)
    expect(screen.getByRole('link', { name: /billing settings/i })).toHaveAttribute(
      'href',
      `/org/${organization.id}/billing/settings`
    )
  })
})
