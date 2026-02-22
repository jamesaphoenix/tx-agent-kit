import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import { CreateInvitationForm } from './CreateInvitationForm'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

describe('CreateInvitationForm integration', () => {
  it('creates pending invitations through the web form', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'invite-owner@example.com',
      password: 'invite-owner-pass-12345',
      name: 'Invite Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee@example.com',
      password: 'invitee-pass-12345',
      name: 'Invitee User'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invitation Workspace'
    })

    writeAuthToken(owner.token)

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(
      <CreateInvitationForm
        workspaces={[{ id: workspace.id, name: workspace.name }]}
        onCreated={onCreated}
      />
    )

    await user.type(screen.getByLabelText('Email'), invitee.user.email)
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })

    writeAuthToken(invitee.token)

    const invitations = await clientApi.listInvitations()
    expect(invitations.invitations.some((invitation) => invitation.status === 'pending')).toBe(true)
  })
})
