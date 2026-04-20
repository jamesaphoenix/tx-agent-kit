import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { notify } from '@/lib/notify'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import { CreateInvitationForm } from './CreateInvitationForm'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

describe('CreateInvitationForm integration', () => {
  it('creates pending invitations through the web form', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      name: 'Invite Owner'
    })

    const invitee = await createUser(factoryContext, {
      name: 'Invitee User'
    })

    const organization = await createOrganization(factoryContext, {
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
    const notifyErrorSpy = vi.spyOn(notify, 'error')
    const user = userEvent.setup()

    renderWithProviders(<CreateInvitationForm organizations={[]} onCreated={onCreated} />)

    await user.type(screen.getByLabelText('Email'), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => {
      expect(notifyErrorSpy).toHaveBeenCalledWith('Create an organization first')
    })

    expect(onCreated).not.toHaveBeenCalled()
    notifyErrorSpy.mockRestore()
  })

  it('surfaces an error and does not create invitations for non-organization members', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      name: 'Invite Owner Forbidden'
    })

    const outsider = await createUser(factoryContext, {
      name: 'Invite Outsider Forbidden'
    })

    const invitee = await createUser(factoryContext, {
      name: 'Invitee Forbidden'
    })

    const organization = await createOrganization(factoryContext, {
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

  it('creates pending invitations for emails without an existing account', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      name: 'Invite Owner Unknown Email'
    })

    const organization = await createOrganization(factoryContext, {
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

    const unknownEmail = `invitee-without-account-${randomUUID()}@example.com`
    await user.type(screen.getByLabelText('Email'), unknownEmail)
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })

    const persistedInvitation = await factoryContext.testContext.withSchemaClient(
      async (client) => {
        const result = await client.query<{ email: string; status: string }>(
          `
            SELECT email, status
              FROM invitations
             WHERE organization_id = $1
               AND email = $2
             LIMIT 1
          `,
          [organization.id, unknownEmail]
        )

        return result.rows[0] ?? null
      }
    )

    expect(persistedInvitation).toEqual({
      email: unknownEmail,
      status: 'pending'
    })
  })
})
