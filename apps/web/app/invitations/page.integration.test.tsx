import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createOrganization, createUser, defaultTestBrandSettings } from '@tx-agent-kit/testkit'
import { within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InvitationsPage from './page'
import {
  organizationsCreateInvitation,
  organizationsRemoveInvitation
} from '@/lib/api/generated/organizations/organizations'
import { teamsCreateTeam } from '@/lib/api/generated/teams/teams'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '../../integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '../../integration/test-utils'

describe('InvitationsPage integration', () => {
  it('shows default state when no auth token is present', async () => {
    renderWithProviders(<InvitationsPage />)

    // Without a token the session bootstrap resolves with no principal.
    // The page uses enabled: isSessionReady so it fires the query unauthenticated
    // and shows its default state without redirecting.
    await waitFor(() => {
      expect(screen.getByText('Invitation activity')).toBeInTheDocument()
    })
  })

  it('loads pending invitation data for invitee', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Owner'
    })

    const invitee = await createUser(factoryContext, {
      name: 'Invitations Invitee'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Integration Team'
    })

    writeAuthToken(owner.token)
    await clientApi.createInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      expect(screen.getByText('Pending invitations')).toBeInTheDocument()
    })

    const pendingHeading = await screen.findByRole('heading', { name: 'Pending invitations' })
    const pendingSection = pendingHeading.closest('section')
    expect(pendingSection).toBeTruthy()
    if (!pendingSection) {
      throw new Error('Expected pending invitations section to exist')
    }

    expect(within(pendingSection).getByText(invitee.user.email)).toBeInTheDocument()
    expect(await screen.findByText('pending')).toBeInTheDocument()
    expect(readIntegrationRouterLocation().pathname).not.toBe('/sign-in')
  })

  it('loads organization context for owner and keeps invitation activity invitee-scoped', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Owner Activity'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Owner Activity Team'
    })

    writeAuthToken(owner.token)

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      expect(screen.getByText('Invitation history')).toBeInTheDocument()
    })

    const inviteFormHeading = await screen.findByRole('heading', { name: 'Invite a teammate' })
    const inviteForm = inviteFormHeading.closest('form')
    if (!inviteForm) {
      throw new Error('Expected invite form to be rendered')
    }

    const inviteFormQueries = within(inviteForm)
    const inviteOrganizationSelect = inviteFormQueries.getByLabelText('Organization')
    expect(
      await within(inviteOrganizationSelect).findByRole('option', { name: organization.name })
    ).toBeInTheDocument()
    expect(await screen.findByText('No invitations yet.')).toBeInTheDocument()
    expect(readIntegrationRouterLocation().pathname).not.toBe('/sign-in')
  })

  it('sends invitations from page-level controls', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Page Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Invitations Page Invitee'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Page Team'
    })

    writeAuthToken(owner.token)
    const user = userEvent.setup()

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      expect(screen.getByText('Invite a teammate')).toBeInTheDocument()
    }, { timeout: 5000 })

    const inviteFormHeading = screen.getByRole('heading', { name: 'Invite a teammate' })
    const inviteForm = inviteFormHeading.closest('form')
    if (!inviteForm) {
      throw new Error('Expected invite form to be rendered')
    }

    const inviteFormQueries = within(inviteForm)
    const inviteOrganizationSelect = inviteFormQueries.getByLabelText('Organization')
    expect(
      await within(inviteOrganizationSelect).findByRole(
        'option',
        { name: organization.name },
        { timeout: 5000 }
      )
    ).toBeInTheDocument()

    await user.selectOptions(
      inviteOrganizationSelect,
      organization.id
    )
    expect((inviteOrganizationSelect as HTMLSelectElement).value).toBe(organization.id)

    await user.type(inviteFormQueries.getByLabelText('Email address'), invitee.user.email)

    const sendInvitationButton = inviteFormQueries.getByRole('button', { name: 'Send invitation' })
    expect(sendInvitationButton).not.toBeDisabled()
    await user.click(sendInvitationButton)

    writeAuthToken(invitee.token)
    await waitFor(async () => {
      const inviteeInvitations = await clientApi.listInvitations()
      const created = inviteeInvitations.data.find((invitation) => invitation.email === invitee.user.email)
      expect(created?.status).toBe('pending')
    }, { timeout: 10_000 })
  })

  it('accepts invitations from page-level manual token controls', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Manual Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Invitations Manual Invitee'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Manual Team'
    })

    writeAuthToken(owner.token)
    const invitation = await organizationsCreateInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)
    const user = userEvent.setup()

    renderWithProviders(<InvitationsPage />)

    await user.type(screen.getByPlaceholderText('Paste invitation token'), invitation.token)
    await user.click(screen.getByRole('button', { name: 'Accept token' }))

    await waitFor(async () => {
      const inviteeInvitations = await clientApi.listInvitations()
      const accepted = inviteeInvitations.data.find((item) => item.id === invitation.id)
      expect(accepted?.status).toBe('accepted')
    }, { timeout: 10_000 })
  })

  it('accepts a pending invitation from the invitation row action', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Row Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Invitations Row Invitee'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Row Team'
    })

    writeAuthToken(owner.token)
    const invitation = await clientApi.createInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)
    const user = userEvent.setup()
    renderWithProviders(<InvitationsPage />)

    const pendingHeading = await screen.findByRole('heading', { name: 'Pending invitations' })
    const pendingSection = pendingHeading.closest('section')
    if (!pendingSection) {
      throw new Error('Expected pending invitations section to exist')
    }

    const invitationRow = within(pendingSection).getByText(invitee.user.email).closest('[data-testid="invitation-row"]')
    if (!(invitationRow instanceof HTMLElement)) {
      throw new Error('Expected pending invitation row to exist')
    }

    await user.click(within(invitationRow).getByRole('button', { name: 'Accept invitation' }))

    await waitFor(async () => {
      const inviteeInvitations = await clientApi.listInvitations()
      const accepted = inviteeInvitations.data.find((item) => item.id === invitation.id)
      expect(accepted?.status).toBe('accepted')
    }, { timeout: 10_000 })
  })

  it('accepts all pending scoped invitations for one organization', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Multi Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Invitations Multi Invitee'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Multi Team'
    })

    writeAuthToken(owner.token)
    const launchTeam = await teamsCreateTeam({
      organizationId: organization.id,
      name: 'Launch Workspace',
      brandSettings: defaultTestBrandSettings
    })
    const supportTeam = await teamsCreateTeam({
      organizationId: organization.id,
      name: 'Support Workspace',
      brandSettings: defaultTestBrandSettings
    })

    const launchInvitation = await organizationsCreateInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member',
      teamId: launchTeam.id
    })
    const supportInvitation = await organizationsCreateInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member',
      teamId: supportTeam.id
    })

    writeAuthToken(invitee.token)
    const user = userEvent.setup()
    renderWithProviders(<InvitationsPage />)

    const pendingHeading = await screen.findByRole('heading', { name: 'Pending invitations' })
    const pendingSection = pendingHeading.closest('section')
    if (!pendingSection) {
      throw new Error('Expected pending invitations section to exist')
    }

    await waitFor(() => {
      expect(within(pendingSection).getAllByText(invitee.user.email)).toHaveLength(2)
      expect(within(pendingSection).getAllByText('Workspace scoped')).toHaveLength(2)
    })

    await user.click(within(pendingSection).getByRole('button', { name: /accept all invitations from this organization/i }))

    await waitFor(async () => {
      const inviteeInvitations = await clientApi.listInvitations()
      const acceptedIds = inviteeInvitations.data
        .filter((item) => item.status === 'accepted')
        .map((item) => item.id)
      expect(acceptedIds).toEqual(expect.arrayContaining([launchInvitation.id, supportInvitation.id]))
    }, { timeout: 10_000 })
  })

  it('accept all only accepts invitations from the matching organization', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Mixed Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Invitations Mixed Invitee'
    })
    const firstOrganization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Mixed First Team'
    })
    const secondOrganization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Mixed Second Team'
    })

    writeAuthToken(owner.token)
    const firstLaunchTeam = await teamsCreateTeam({
      organizationId: firstOrganization.id,
      name: 'First Launch Workspace',
      brandSettings: defaultTestBrandSettings
    })
    const firstSupportTeam = await teamsCreateTeam({
      organizationId: firstOrganization.id,
      name: 'First Support Workspace',
      brandSettings: defaultTestBrandSettings
    })

    const firstLaunchInvitation = await organizationsCreateInvitation({
      organizationId: firstOrganization.id,
      email: invitee.user.email,
      role: 'member',
      teamId: firstLaunchTeam.id
    })
    const firstSupportInvitation = await organizationsCreateInvitation({
      organizationId: firstOrganization.id,
      email: invitee.user.email,
      role: 'member',
      teamId: firstSupportTeam.id
    })
    const secondOrgInvitation = await organizationsCreateInvitation({
      organizationId: secondOrganization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)
    const user = userEvent.setup()
    renderWithProviders(<InvitationsPage />)

    const pendingHeading = await screen.findByRole('heading', { name: 'Pending invitations' })
    const pendingSection = pendingHeading.closest('section')
    if (!pendingSection) {
      throw new Error('Expected pending invitations section to exist')
    }

    await user.click(within(pendingSection).getByRole('button', { name: /accept all invitations from this organization/i }))

    await waitFor(async () => {
      const inviteeInvitations = await clientApi.listInvitations()
      const firstLaunch = inviteeInvitations.data.find((item) => item.id === firstLaunchInvitation.id)
      const firstSupport = inviteeInvitations.data.find((item) => item.id === firstSupportInvitation.id)
      const secondOrg = inviteeInvitations.data.find((item) => item.id === secondOrgInvitation.id)
      expect(firstLaunch?.status).toBe('accepted')
      expect(firstSupport?.status).toBe('accepted')
      expect(secondOrg?.status).toBe('pending')
    }, { timeout: 10_000 })
  })

  it('accepts the remaining valid organization invitations when one stale invite was revoked', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Stale Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Invitations Stale Invitee'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Stale Team'
    })

    writeAuthToken(owner.token)
    const launchTeam = await teamsCreateTeam({
      organizationId: organization.id,
      name: 'Stale Launch Workspace',
      brandSettings: defaultTestBrandSettings
    })
    const supportTeam = await teamsCreateTeam({
      organizationId: organization.id,
      name: 'Stale Support Workspace',
      brandSettings: defaultTestBrandSettings
    })

    const launchInvitation = await organizationsCreateInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member',
      teamId: launchTeam.id
    })
    const supportInvitation = await organizationsCreateInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member',
      teamId: supportTeam.id
    })

    writeAuthToken(invitee.token)
    const user = userEvent.setup()
    renderWithProviders(<InvitationsPage />)

    const pendingHeading = await screen.findByRole('heading', { name: 'Pending invitations' })
    const pendingSection = pendingHeading.closest('section')
    if (!pendingSection) {
      throw new Error('Expected pending invitations section to exist')
    }

    await waitFor(() => {
      expect(within(pendingSection).getAllByText(invitee.user.email)).toHaveLength(2)
    })

    writeAuthToken(owner.token)
    await organizationsRemoveInvitation(supportInvitation.id)
    writeAuthToken(invitee.token)

    await user.click(within(pendingSection).getByRole('button', { name: /accept all invitations from this organization/i }))

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/workspaces`)
    }, { timeout: 10_000 })

    const inviteeInvitations = await clientApi.listInvitations()
    const accepted = inviteeInvitations.data.find((item) => item.id === launchInvitation.id)
    const revoked = inviteeInvitations.data.find((item) => item.id === supportInvitation.id)
    expect(accepted?.status).toBe('accepted')
    expect(revoked?.status).toBe('revoked')
  })

  it('auto-accepts invitation token from query params', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Invitations Auto Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Invitations Auto Invitee'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invitations Auto Team'
    })

    writeAuthToken(owner.token)
    const invitation = await clientApi.createInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)
    resetIntegrationRouterLocation(`/invitations?token=${encodeURIComponent(invitation.token)}`)

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      const loc = readIntegrationRouterLocation().pathname
      // After auto-accept, redirects to the org's workspaces or to /org
      expect(loc === `/org/${organization.id}/workspaces` || loc === '/org').toBe(true)
    }, { timeout: 5000 })

    const inviteeInvitations = await clientApi.listInvitations()
    const accepted = inviteeInvitations.data.find((item) => item.id === invitation.id)
    expect(accepted?.status).toBe('accepted')
  })

  it('clears auth token when token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<InvitationsPage />)

    // AuthBootstrapProvider calls restoreCurrentPrincipal which clears the token
    // on auth error, then calls sessionStoreActions.clear().
    await waitFor(() => {
      expect(readAuthToken()).toBeNull()
    })
  })
})
