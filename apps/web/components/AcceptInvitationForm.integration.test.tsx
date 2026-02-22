import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import { AcceptInvitationForm } from './AcceptInvitationForm'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

describe('AcceptInvitationForm integration', () => {
  it('accepts invitations through the web form', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'accept-owner@example.com',
      password: 'accept-owner-pass-12345',
      name: 'Accept Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: 'accept-invitee@example.com',
      password: 'accept-invitee-pass-12345',
      name: 'Accept Invitee'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Accept Invitation Workspace'
    })

    writeAuthToken(owner.token)

    const createdInvitation = await clientApi.createInvitation({
      workspaceId: workspace.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)

    const onAccepted = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<AcceptInvitationForm onAccepted={onAccepted} />)

    await user.type(
      screen.getByPlaceholderText('Paste invitation token'),
      createdInvitation.token
    )
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1)
    })

    const invitations = await clientApi.listInvitations()
    const accepted = invitations.invitations.find((invitation) => invitation.id === createdInvitation.id)
    expect(accepted?.status).toBe('accepted')
  })
})
