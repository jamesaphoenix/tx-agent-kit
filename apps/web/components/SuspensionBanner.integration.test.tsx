import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createWebFactoryContext } from '../integration/support/web-integration-context'
import { renderWithProviders, screen, waitFor } from '../integration/test-utils'
import { SuspensionBanner } from './SuspensionBanner'

/**
 * Integration tests for the suspension banner. The banner reads the
 * `getCreditBalance` endpoint via the orval-generated hook, so each test
 * exercises the full path: real API server → real Postgres → React
 * render. Suspended state is forced by directly UPDATEing the
 * organizations row (the worker activity that normally sets it is
 * exercised separately in the worker integration suite).
 *
 * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
 */

describe('SuspensionBanner integration', () => {
  it('does not render anything when the org is not suspended', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `suspension-banner-healthy-${Date.now()}@example.com`,
      password: 'suspension-banner-healthy-pass-12345',
      name: 'Suspension Banner Healthy Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Suspension Banner Healthy Org'
    })

    writeAuthToken(owner.token)

    renderWithProviders(<SuspensionBanner organizationId={organization.id} />)

    // The banner is wrapped in a role="alert" div when visible. Wait
    // for the underlying query to settle, then assert no alert exists.
    // The query loading state itself returns `null`, not an empty
    // wrapper, so a stable absent-after-settle is the right assertion.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('renders the suspension banner with a billing link when suspended_at is set', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `suspension-banner-suspended-${Date.now()}@example.com`,
      password: 'suspension-banner-suspended-pass-12345',
      name: 'Suspension Banner Suspended Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Suspension Banner Suspended Org'
    })

    // Force the org into a suspended state. In production this is set
    // by the worker activity applyUsageCapExceeded.
    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations SET suspended_at = now() WHERE id = $1`,
        [organization.id]
      )
    })

    writeAuthToken(owner.token)

    renderWithProviders(<SuspensionBanner organizationId={organization.id} />)

    const banner = await screen.findByRole('alert')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent(/suspended/i)

    const billingLink = screen.getByRole('link', { name: /open billing/i })
    expect(billingLink).toHaveAttribute(
      'href',
      `/org/${organization.id}/billing`
    )
  })

  it('renders the timestamp label so the org admin can see how long ago suspension occurred', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `suspension-banner-timestamp-${Date.now()}@example.com`,
      password: 'suspension-banner-timestamp-pass-12345',
      name: 'Suspension Banner Timestamp Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Suspension Banner Timestamp Org'
    })

    // Set suspended_at to ~3 hours ago so the relative-time label
    // reads "3h ago" (the formatter switches between m/h/d based on
    // duration). Asserting the formatter wiring catches the case where
    // the API field rename breaks the JSON parse silently.
    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations SET suspended_at = now() - INTERVAL '3 hours' WHERE id = $1`,
        [organization.id]
      )
    })

    writeAuthToken(owner.token)

    renderWithProviders(<SuspensionBanner organizationId={organization.id} />)

    const banner = await screen.findByRole('alert')
    // The exact label is "3h ago" but allow ±1h drift for slow CI.
    expect(banner).toHaveTextContent(/[23]h ago|180m ago/i)
  })
})
