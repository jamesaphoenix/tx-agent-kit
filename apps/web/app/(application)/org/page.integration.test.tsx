import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import OrgRedirectPage from './page'
import {
  organizationsCreateInvitation,
  organizationsRemoveInvitation
} from '@/lib/api/generated/organizations/organizations'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, waitFor } from '@/integration/test-utils'

describe('OrgRedirectPage integration', () => {
  it('routes users with no organizations but pending invitations to the invitations page', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Pending Invite Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Pending Invite Recipient'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Pending Invite Organization'
    })

    writeAuthToken(owner.token)
    await organizationsCreateInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)
    resetIntegrationRouterLocation('/org')

    renderWithProviders(<OrgRedirectPage />)

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/invitations')
    })
  })

  it('routes users with no organizations and no pending invitations to onboarding', async () => {
    const factoryContext = createWebFactoryContext()
    const user = await createUser(factoryContext, {
      name: 'No Organization User'
    })

    writeAuthToken(user.token)
    resetIntegrationRouterLocation('/org')

    renderWithProviders(<OrgRedirectPage />)

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/org/onboarding')
    })
  })

  it('ignores revoked invitations when deciding whether to skip onboarding', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Revoked Invite Owner'
    })
    const invitee = await createUser(factoryContext, {
      name: 'Revoked Invite Recipient'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Revoked Invite Organization'
    })

    writeAuthToken(owner.token)
    const invitation = await organizationsCreateInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })
    await organizationsRemoveInvitation(invitation.id)

    writeAuthToken(invitee.token)
    resetIntegrationRouterLocation('/org')

    renderWithProviders(<OrgRedirectPage />)

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe('/org/onboarding')
    })
  })
})
