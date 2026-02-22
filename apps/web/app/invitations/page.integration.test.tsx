import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import InvitationsPage from './page'
import { mockRouter } from '../../integration/mocks/next-navigation'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'
import { renderWithProviders, screen, waitFor } from '../../integration/test-utils'

describe('InvitationsPage integration', () => {
  it('redirects to sign-in when no auth token is present', async () => {
    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in?next=%2Finvitations')
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

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invitations Integration Team'
    })

    writeAuthToken(owner.token)
    await clientApi.createInvitation({
      workspaceId: workspace.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      expect(screen.getByText('Invitation activity')).toBeInTheDocument()
    })

    expect(await screen.findByText(invitee.user.email)).toBeInTheDocument()
    expect(await screen.findByText('Status: pending')).toBeInTheDocument()
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/sign-in?next=%2Finvitations')
  })

  it('redirects to sign-in and clears session when auth token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<InvitationsPage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in?next=%2Finvitations')
    })

    expect(readAuthToken()).toBeNull()
  })
})
