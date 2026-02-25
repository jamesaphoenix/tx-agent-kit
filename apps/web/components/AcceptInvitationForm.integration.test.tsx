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

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Accept Invitation Organization'
    })

    writeAuthToken(owner.token)

    const createdInvitation = await clientApi.createInvitation({
      organizationId: organization.id,
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
    const accepted = invitations.data.find((invitation) => invitation.id === createdInvitation.id)
    expect(accepted?.status).toBe('accepted')
  })

  it('surfaces an error and keeps invitation pending when token is invalid', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'accept-owner-invalid-token@example.com',
      password: 'accept-owner-pass-12345',
      name: 'Accept Owner Invalid Token'
    })

    const invitee = await createUser(factoryContext, {
      email: 'accept-invitee-invalid-token@example.com',
      password: 'accept-invitee-pass-12345',
      name: 'Accept Invitee Invalid Token'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Accept Invalid Token Organization'
    })

    writeAuthToken(owner.token)

    const createdInvitation = await clientApi.createInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(invitee.token)

    const onAccepted = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<AcceptInvitationForm onAccepted={onAccepted} />)

    await user.type(
      screen.getByPlaceholderText('Paste invitation token'),
      `${createdInvitation.token}-invalid`
    )
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => {
      expect(
        screen.getByText(/failed to accept invitation|not found|invalid|unauthorized/i)
      ).toBeInTheDocument()
    })

    expect(onAccepted).not.toHaveBeenCalled()

    const invitations = await clientApi.listInvitations()
    const pending = invitations.data.find((invitation) => invitation.id === createdInvitation.id)
    expect(pending?.status).toBe('pending')
  })

  it('surfaces an error and keeps invitation pending when token is accepted by the wrong user', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'accept-owner-wrong-user@example.com',
      password: 'accept-owner-pass-12345',
      name: 'Accept Owner Wrong User'
    })

    const invitee = await createUser(factoryContext, {
      email: 'accept-invitee-wrong-user@example.com',
      password: 'accept-invitee-pass-12345',
      name: 'Accept Invitee Wrong User'
    })

    const attacker = await createUser(factoryContext, {
      email: 'accept-attacker-wrong-user@example.com',
      password: 'accept-attacker-pass-12345',
      name: 'Accept Attacker Wrong User'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Accept Wrong User Organization'
    })

    writeAuthToken(owner.token)

    const createdInvitation = await clientApi.createInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    writeAuthToken(attacker.token)

    const onAccepted = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<AcceptInvitationForm onAccepted={onAccepted} />)

    await user.type(
      screen.getByPlaceholderText('Paste invitation token'),
      createdInvitation.token
    )
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => {
      expect(
        screen.getByText(/failed to accept invitation|not found|unauthorized|invalid/i)
      ).toBeInTheDocument()
    })

    const { invitationStatus, attackerMembershipCount, inviteeMembershipCount } =
      await factoryContext.testContext.withSchemaClient(async (client) => {
        const invitationResult = await client.query<{ status: string }>(
          `
            SELECT status
            FROM invitations
            WHERE id = $1
          `,
          [createdInvitation.id]
        )

        const attackerMembershipResult = await client.query<{ count: string | number }>(
          `
            SELECT COUNT(*)::int AS count
            FROM org_members
            WHERE organization_id = $1
              AND user_id = $2
          `,
          [organization.id, attacker.user.id]
        )

        const inviteeMembershipResult = await client.query<{ count: string | number }>(
          `
            SELECT COUNT(*)::int AS count
            FROM org_members
            WHERE organization_id = $1
              AND user_id = $2
          `,
          [organization.id, invitee.user.id]
        )

        const parseCount = (value: string | number | undefined): number =>
          typeof value === 'number' ? value : Number.parseInt(value ?? '0', 10)

        return {
          invitationStatus: invitationResult.rows[0]?.status ?? null,
          attackerMembershipCount: parseCount(attackerMembershipResult.rows[0]?.count),
          inviteeMembershipCount: parseCount(inviteeMembershipResult.rows[0]?.count)
        }
      })

    expect(onAccepted).not.toHaveBeenCalled()
    expect(invitationStatus).toBe('pending')
    expect(attackerMembershipCount).toBe(0)
    expect(inviteeMembershipCount).toBe(0)
  })

  it('surfaces an error when reusing a previously accepted invitation token', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'accept-owner-reused-token@example.com',
      password: 'accept-owner-pass-12345',
      name: 'Accept Owner Reused Token'
    })

    const invitee = await createUser(factoryContext, {
      email: 'accept-invitee-reused-token@example.com',
      password: 'accept-invitee-pass-12345',
      name: 'Accept Invitee Reused Token'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Accept Reused Token Organization'
    })

    writeAuthToken(owner.token)

    const createdInvitation = await clientApi.createInvitation({
      organizationId: organization.id,
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

    await user.type(
      screen.getByPlaceholderText('Paste invitation token'),
      createdInvitation.token
    )
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => {
      expect(
        screen.getByText(/failed to accept invitation|not found|expired|invalid/i)
      ).toBeInTheDocument()
    })

    expect(onAccepted).toHaveBeenCalledTimes(1)

    const invitations = await clientApi.listInvitations()
    const accepted = invitations.data.find((invitation) => invitation.id === createdInvitation.id)
    expect(accepted?.status).toBe('accepted')
  })

  it('surfaces an error and keeps invitation pending when token is expired', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'accept-owner-expired-token@example.com',
      password: 'accept-owner-pass-12345',
      name: 'Accept Owner Expired Token'
    })

    const invitee = await createUser(factoryContext, {
      email: 'accept-invitee-expired-token@example.com',
      password: 'accept-invitee-pass-12345',
      name: 'Accept Invitee Expired Token'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Accept Expired Token Organization'
    })

    writeAuthToken(owner.token)

    const createdInvitation = await clientApi.createInvitation({
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE invitations
          SET expires_at = now() - interval '1 hour'
          WHERE id = $1
        `,
        [createdInvitation.id]
      )
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
      expect(
        screen.getByText(/failed to accept invitation|not found|expired|invalid/i)
      ).toBeInTheDocument()
    })

    expect(onAccepted).not.toHaveBeenCalled()

    const invitations = await clientApi.listInvitations()
    const pending = invitations.data.find((invitation) => invitation.id === createdInvitation.id)
    expect(pending?.status).toBe('pending')
  })
})
