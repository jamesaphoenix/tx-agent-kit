import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import BillingOverviewPage from '@/app/(application)/org/[orgId]/billing/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderBillingOverviewPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <BillingOverviewPage />
    </PathParamsContext.Provider>
  )
}

describe('BillingOverviewPage integration', () => {
  it('renders the dedicated billing overview route with next-charge summary cards and quick actions [INV-REQ-BILLING-AND-PRICING-008]', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-overview-owner-${randomUUID()}@example.com`,
      password: 'billing-overview-owner-pass-12345',
      name: 'Billing Overview Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Overview Org'
    })


    const nextChargeAt = new Date('2026-05-01T12:00:00.000Z')

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET credits_balance = $2,
                 reserved_credits = $3,
                 subscription_status = 'active',
                 subscription_plan = 'pro',
                 stripe_customer_id = $4,
                 billing_email = $5,
                 usage_cap = $6,
                 subscription_current_period_end = $9,
                 auto_recharge_enabled = true,
                 auto_recharge_threshold = $7,
                 auto_recharge_amount = $8
           WHERE id = $1
        `,
        [
          organization.id,
          2_000_000_000,
          250_000_000,
          `cus_${randomUUID()}`,
          'billing-overview@example.com',
          5_000_000_000,
          500_000_000,
          2_500_000_000,
          nextChargeAt
        ]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing`)

    renderBillingOverviewPage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^billing$/i })).toBeInTheDocument()
      expect(screen.getByText(/credit balance/i)).toBeInTheDocument()
      expect(screen.getByText(/current billing state/i)).toBeInTheDocument()
      expect(screen.getByText(/billing-overview@example\.com/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /top up credits/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /manage payment method/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /change plan/i })).toHaveAttribute(
        'href',
        `/org/${organization.id}/billing/plans`
      )
      expect(screen.getByRole('link', { name: /view credit history/i })).toHaveAttribute(
        'href',
        `/org/${organization.id}/billing/history`
      )
      expect(screen.getByText(/next charge/i)).toBeInTheDocument()
      expect(screen.getByText(/1 may 2026/i)).toBeInTheDocument()
      expect(screen.getByText('Healthy')).toBeInTheDocument()
      expect(screen.getByText(/available credits/i)).toBeInTheDocument()
      expect(screen.getByText('$175.00')).toBeInTheDocument()
    })

    const sidebar = document.querySelector('aside[data-variant="sidebar"]')
    expect(sidebar?.className).toContain('sticky')
    expect(sidebar?.className).toContain('top-0')
  })

  it('exposes a local billing activation control that seeds subscription state and welcome credit', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-overview-local-dev-${randomUUID()}@example.com`,
      password: 'billing-overview-local-dev-pass-12345',
      name: 'Billing Overview Local Dev Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Overview Local Dev Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing`)

    const user = userEvent.setup()
    renderBillingOverviewPage(organization.id)

    await user.click(await screen.findByRole('button', { name: /activate local pro \+ \$20(?:\.00)? credit/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.isSubscribed).toBe(true)
      expect(billing.subscriptionStatus).toBe('active')
      expect(billing.subscriptionPlan).toBe('pro')
      expect(billing.creditsBalanceDecimillicents).toBe(200_000_000)
    })

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/onboarding/welcome`)
    })
  })

  it('opens the 3DS challenge modal when an auto-recharge requires authentication', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-overview-3ds-owner-${randomUUID()}@example.com`,
      password: 'billing-overview-3ds-owner-pass-12345',
      name: 'Billing Overview 3DS Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Overview 3DS Org'
    })

    const attemptId = randomUUID()
    const stripePaymentIntentId = `pi_${randomUUID().replaceAll('-', '')}`
    const clientSecret = `${stripePaymentIntentId}_secret_${randomUUID().replaceAll('-', '')}`

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO auto_recharge_attempts (
            id,
            organization_id,
            amount_decimillicents,
            status,
            stripe_payment_intent_id,
            failure_reason,
            completed_at
          )
          VALUES ($1, $2, $3, 'failed', $4, 'requires user action', now())
        `,
        [attemptId, organization.id, 900_000, stripePaymentIntentId]
      )

      await client.query(
        `
          INSERT INTO domain_events (
            event_type,
            aggregate_type,
            aggregate_id,
            payload,
            sequence_number
          )
          VALUES (
            'billing.recharge_requires_action',
            'billing',
            $1,
            $2::jsonb,
            (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM domain_events WHERE aggregate_id = $1)
          )
        `,
        [
          organization.id,
          JSON.stringify({
            organizationId: organization.id,
            attemptId,
            amountDecimillicents: 900_000,
            stripePaymentIntentId,
            clientSecret
          })
        ]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/billing`)

    renderBillingOverviewPage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /complete bank authentication/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /continue authentication/i })).toBeInTheDocument()
    })
  })

  it('shows the billing access guard to members without manage_billing permission', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-overview-owner-gate-${randomUUID()}@example.com`,
      password: 'billing-overview-owner-gate-pass-12345',
      name: 'Billing Overview Gate Owner'
    })
    const member = await createUser(factoryContext, {
      email: `billing-overview-member-${randomUUID()}@example.com`,
      password: 'billing-overview-member-pass-12345',
      name: 'Billing Overview Member'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Overview Gate Org'
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
    resetIntegrationRouterLocation(`/org/${organization.id}/billing`)

    renderBillingOverviewPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/billing access required/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /top up credits/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/current billing state/i)).not.toBeInTheDocument()
    })
  })
})
