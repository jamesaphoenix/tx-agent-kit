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

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invitation Organization'
    })

    writeAuthToken(owner.token)

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(
      <CreateInvitationForm
        organizations={[{ id: organization.id, name: organization.name }]}
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
    expect(invitations.data.some((invitation) => invitation.status === 'pending')).toBe(true)
  })

  it('shows a local validation error when there are no organizations', async () => {
    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<CreateInvitationForm organizations={[]} onCreated={onCreated} />)

    await user.type(screen.getByLabelText('Email'), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => {
      expect(screen.getByText('Create an organization first')).toBeInTheDocument()
    })

    expect(onCreated).not.toHaveBeenCalled()
  })

  it('surfaces an error and does not create invitations for non-organization members', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'invite-owner-forbidden@example.com',
      password: 'invite-owner-pass-12345',
      name: 'Invite Owner Forbidden'
    })

    const outsider = await createUser(factoryContext, {
      email: 'invite-outsider-forbidden@example.com',
      password: 'invite-outsider-pass-12345',
      name: 'Invite Outsider Forbidden'
    })

    const invitee = await createUser(factoryContext, {
      email: 'invitee-forbidden@example.com',
      password: 'invitee-pass-12345',
      name: 'Invitee Forbidden'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invitation Forbidden Organization'
    })

    writeAuthToken(outsider.token)

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(
      <CreateInvitationForm
        organizations={[{ id: organization.id, name: organization.name }]}
        onCreated={onCreated}
      />
    )

    await user.type(screen.getByLabelText('Email'), invitee.user.email)
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => {
      expect(
        screen.getByText(/failed to send invitation|unauthorized|forbidden/i)
      ).toBeInTheDocument()
    })

    expect(onCreated).not.toHaveBeenCalled()

    writeAuthToken(owner.token)
    const invitations = await clientApi.listInvitations()
    expect(
      invitations.data.some((invitation) => invitation.email === invitee.user.email)
    ).toBe(false)
  })

  it('surfaces an error when inviting an email without an existing account', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'invite-owner-unknown-email@example.com',
      password: 'invite-owner-pass-12345',
      name: 'Invite Owner Unknown Email'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Invitation Unknown Email Organization'
    })

    writeAuthToken(owner.token)

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(
      <CreateInvitationForm
        organizations={[{ id: organization.id, name: organization.name }]}
        onCreated={onCreated}
      />
    )

    const unknownEmail = 'invitee-without-account@example.com'
    await user.type(screen.getByLabelText('Email'), unknownEmail)
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          /failed to send invitation|must already have an account|invalid|network error/i
        )
      ).toBeInTheDocument()
    })

    expect(onCreated).not.toHaveBeenCalled()

    const invitations = await clientApi.listInvitations()
    expect(
      invitations.data.some((invitation) => invitation.email === unknownEmail)
    ).toBe(false)
  })
})
