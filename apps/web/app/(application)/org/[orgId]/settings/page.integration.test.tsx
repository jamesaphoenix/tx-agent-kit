import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createOrganization, createUser, createUserWithOrgAndInvitation } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import OrgSettingsPage from '@/app/(application)/org/[orgId]/settings/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderSettingsPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <OrgSettingsPage />
    </PathParamsContext.Provider>
  )
}

describe('OrgSettingsPage integration', () => {
  it('renders org name and billing email', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-owner-${randomUUID()}@example.com`,
      password: 'settings-owner-pass-12345',
      name: 'Settings Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Settings Integration Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    renderSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText('Settings Integration Org')).toBeInTheDocument()
      // The email appears in both the sidebar footer and the page content (sr-only span),
      // so use getAllByText to tolerate multiple matches.
      expect(screen.getAllByText(owner.user.email).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('keeps the desktop sidebar sticky and shows the current credit balance in the footer', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-sidebar-owner-${randomUUID()}@example.com`,
      password: 'settings-sidebar-pass-12345',
      name: 'Settings Sidebar Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Settings Sidebar Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    renderSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/available credits/i)).toBeInTheDocument()
      expect(screen.getByText('$0.00')).toBeInTheDocument()
    })

    const sidebar = document.querySelector('aside[data-variant="sidebar"]')
    expect(sidebar).not.toBeNull()
    expect(sidebar).toHaveClass('sticky')
    expect(sidebar).toHaveClass('top-0')
  })

  it('shows the current available credits in the desktop sidebar footer', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-sidebar-credits-owner-${randomUUID()}@example.com`,
      password: 'settings-sidebar-credits-pass-12345',
      name: 'Sidebar Credits Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Sidebar Credits Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
             SET credits_balance = $2,
                 reserved_credits = $3
           WHERE id = $1
        `,
        [organization.id, 123_400_000, 23_400_000]
      )
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    renderSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByText(/available credits/i)).toBeInTheDocument()
      expect(screen.getByText('$10.00')).toBeInTheDocument()
    })
  })

  it('owner can update org name', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-update-name-owner-${randomUUID()}@example.com`,
      password: 'settings-update-name-pass-12345',
      name: 'Update Name Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Original Org Name'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    const user = userEvent.setup()
    renderSettingsPage(organization.id)

    const nameInput = await screen.findByLabelText('Organization name')
    // Wait for the form to be seeded from the org query before typing,
    // otherwise a late-arriving query (e.g. billing) can re-fire the form
    // sync effect and clobber the typed value.
    await waitFor(() => {
      expect((nameInput as HTMLInputElement).value).toBe('Original Org Name')
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Org Name')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(async () => {
      const updated = await clientApi.getOrganization(organization.id)
      expect(updated.name).toBe('Updated Org Name')
    })
  })

  it('owner can update billing email', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-billing-owner-${randomUUID()}@example.com`,
      password: 'settings-billing-pass-12345',
      name: 'Billing Email Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Email Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    const user = userEvent.setup()
    renderSettingsPage(organization.id)

    // Wait for the billing email to be synced from the query
    const emailInput = await screen.findByLabelText('Billing email')
    await waitFor(() => {
      expect((emailInput as HTMLInputElement).value).not.toBe('')
    })
    await user.clear(emailInput)
    await user.type(emailInput, 'billing@updated-org.com')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.billingEmail).toBe('billing@updated-org.com')
    })
  })

  it('shows billing section with plan info', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-billing-plan-owner-${randomUUID()}@example.com`,
      password: 'settings-billing-plan-pass-12345',
      name: 'Billing Plan Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Plan Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    renderSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /billing/i })).toBeInTheDocument()
    })

    const fullOrg = await clientApi.getOrganization(organization.id)
    expect(screen.getByText(fullOrg.subscriptionStatus)).toBeInTheDocument()

    if (fullOrg.subscriptionPlan) {
      expect(screen.getByText(fullOrg.subscriptionPlan)).toBeInTheDocument()
    }
  })

  it('shows danger zone with delete org button', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-danger-zone-owner-${randomUUID()}@example.com`,
      password: 'settings-danger-zone-pass-12345',
      name: 'Danger Zone Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Risky Settings Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    renderSettingsPage(organization.id)

    // Wait for the danger zone card to appear (the delete button confirms it's the card, not just
    // the subtitle text which also mentions "danger zone").
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete organization/i })).toBeInTheDocument()
    })
  })

  it('owner can delete org', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `settings-delete-org-owner-${randomUUID()}@example.com`,
      password: 'settings-delete-org-pass-12345',
      name: 'Delete Org Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Delete Me Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/settings`)

    const user = userEvent.setup()
    renderSettingsPage(organization.id)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete organization/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /delete organization/i }))

    const confirmInput = await screen.findByPlaceholderText(organization.name)
    await user.type(confirmInput, organization.name)
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location.pathname).toBe('/organizations')
    })

    const organizations = await clientApi.listOrganizations()
    expect(organizations.data.some((org) => org.id === organization.id)).toBe(false)
  })

  it('non-owner cannot see danger zone', async () => {
    const factoryContext = createWebFactoryContext()
    const { invitee, org, invitation } = await createUserWithOrgAndInvitation(factoryContext, {
      owner: {
        email: `settings-non-owner-owner-${randomUUID()}@example.com`,
        password: 'settings-non-owner-owner-pass-12345',
        name: 'Non-Owner Test Owner'
      },
      invitee: {
        email: `settings-non-owner-admin-${randomUUID()}@example.com`,
        password: 'settings-non-owner-admin-pass-12345',
        name: 'Non-Owner Admin'
      },
      organization: { name: 'Admin View Only Org' },
      invitation: { role: 'admin' }
    })

    writeAuthToken(invitee.token)
    await clientApi.acceptInvitation(invitation.token)

    resetIntegrationRouterLocation(`/org/${org.id}/settings`)

    renderSettingsPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Admin View Only Org')).toBeInTheDocument()
    })

    // The DashboardShell subtitle always mentions "danger zone", so we verify the danger zone
    // *card* is absent by checking the delete button is not rendered.
    expect(screen.queryByRole('button', { name: /delete organization/i })).not.toBeInTheDocument()
  })
})
