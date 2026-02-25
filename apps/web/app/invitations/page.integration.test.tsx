import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InvitationsPage from './page'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '../../integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '../../integration/test-utils'

const invitationsSignInRedirect = '/sign-in?next=%2Finvitations'

describe('InvitationsPage integration', () => {
  it('redirects to sign-in when no auth token is present', async () => {
    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location).toEqual({
        pathname: '/sign-in',
        search: '?next=%2Finvitations'
      })
      expect(`${location.pathname}${location.search}`).toBe(invitationsSignInRedirect)
    })
  })

  it('loads pending invitation data for invitee', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'invitations-owner@example.com',
      password: 'invitations-owner-pass-12345',
      name: 'Invitations Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitations-invitee@example.com',
      password: 'invitations-invitee-pass-12345',
      name: 'Invitations Invitee'
    })

    const organization = await createTeam(factoryContext, {
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
      email: 'invitations-owner-activity@example.com',
      password: 'invitations-owner-pass-12345',
      name: 'Invitations Owner Activity'
    })

    const organization = await createTeam(factoryContext, {
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
      email: 'invitations-page-owner@example.com',
      password: 'invitations-page-owner-pass-12345',
      name: 'Invitations Page Owner'
    })
    const invitee = await createUser(factoryContext, {
      email: 'invitations-page-invitee@example.com',
      password: 'invitations-page-invitee-pass-12345',
      name: 'Invitations Page Invitee'
    })
    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invitations Page Team'
    })

    writeAuthToken(owner.token)
    const user = userEvent.setup()

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      expect(screen.getByText('Invite a teammate')).toBeInTheDocument()
    }, { timeout: 5_000 })

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
        { timeout: 5_000 }
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
      email: 'invitations-manual-owner@example.com',
      password: 'invitations-manual-owner-pass-12345',
      name: 'Invitations Manual Owner'
    })
    const invitee = await createUser(factoryContext, {
      email: 'invitations-manual-invitee@example.com',
      password: 'invitations-manual-invitee-pass-12345',
      name: 'Invitations Manual Invitee'
    })
    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invitations Manual Team'
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

    await user.type(screen.getByPlaceholderText('Paste invitation token'), invitation.token)
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(async () => {
      const inviteeInvitations = await clientApi.listInvitations()
      const accepted = inviteeInvitations.data.find((item) => item.id === invitation.id)
      expect(accepted?.status).toBe('accepted')
    }, { timeout: 10_000 })
  })

  it('auto-accepts invitation token from query params', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'invitations-auto-owner@example.com',
      password: 'invitations-auto-owner-pass-12345',
      name: 'Invitations Auto Owner'
    })
    const invitee = await createUser(factoryContext, {
      email: 'invitations-auto-invitee@example.com',
      password: 'invitations-auto-invitee-pass-12345',
      name: 'Invitations Auto Invitee'
    })
    const organization = await createTeam(factoryContext, {
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
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/workspaces`)
    }, { timeout: 5_000 })

    const inviteeInvitations = await clientApi.listInvitations()
    const accepted = inviteeInvitations.data.find((item) => item.id === invitation.id)
    expect(accepted?.status).toBe('accepted')
  })

  it('redirects to sign-in and clears session when auth token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location).toEqual({
        pathname: '/sign-in',
        search: '?next=%2Finvitations'
      })
      expect(`${location.pathname}${location.search}`).toBe(invitationsSignInRedirect)
    })

    expect(readAuthToken()).toBeNull()
  })
})
