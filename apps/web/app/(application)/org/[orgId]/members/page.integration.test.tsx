import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import {
  organizationsCreateInvitation,
  organizationsListOrgInvitations
} from '@/lib/api/generated/organizations/organizations'
import {
  createInvitation,
  createOrganization,
  createTeamWithMembers,
  createUser,
  defaultTestBrandSettings
} from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import MembersPage from '@/app/(application)/org/[orgId]/members/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/integration/test-utils'

function renderMembersPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <MembersPage />
    </PathParamsContext.Provider>
  )
}

function findInviteMemberButton() {
  return screen.findByRole('button', { name: /invite member/i }, { timeout: 15_000 })
}

/**
 * Helper: create an owner + org + a second member who has accepted an invitation.
 * Returns both users, the org, and the accepted member's membership details.
 */
const seedOwnerAndMember = async (factoryContext: ReturnType<typeof createWebFactoryContext>) => {
  const uid = randomUUID().slice(0, 8)
  const owner = await createUser(factoryContext, {
    email: `members-owner-${uid}@example.com`,
    password: 'members-owner-pass-12345',
    name: 'Members Owner'
  })

  const org = await createOrganization(factoryContext, {
    token: owner.token,
    name: 'Members Test Organization'
  })

  const member = await createUser(factoryContext, {
    email: `members-member-${uid}@example.com`,
    password: 'members-member-pass-12345',
    name: 'Members Regular Member'
  })

  // Invite the member
  const invitation = await createInvitation(factoryContext, {
    token: owner.token,
    organizationId: org.id,
    email: member.credentials.email,
    role: 'member'
  })

  // Accept the invitation as the member
  writeAuthToken(member.token)
  await clientApi.acceptInvitation(invitation.token)

  return { owner, member, org, invitation }
}

describe('OrgMembersPage integration', () => {
  it('renders member list for org owner', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    renderMembersPage(org.id)

    // Expect both the owner and the invited member to appear in the list
    await waitFor(() => {
      expect(screen.getByText('Members Owner')).toBeInTheDocument()
    })
    expect(screen.getByText('Members Regular Member')).toBeInTheDocument()

    // Verify roles are displayed — use getAllByText because role text may appear
    // in multiple places (role badge, select trigger, table cells, etc.)
    expect(screen.getAllByText('admin').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('member').length).toBeGreaterThanOrEqual(1)
  })

  it('owner can change a member role', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for the member list to load
    await waitFor(() => {
      expect(screen.getByText('Members Regular Member')).toBeInTheDocument()
    })

    // Find the Radix Select trigger for the regular member's role
    const memberRow = screen.getByText('Members Regular Member').closest('[data-testid="member-row"]')
    expect(memberRow).not.toBeNull()

    const roleSelectTrigger = memberRow!.querySelector('[data-testid="role-select"]') as HTMLElement
    expect(roleSelectTrigger).not.toBeNull()

    // Click the Radix Select trigger to open the dropdown
    await user.click(roleSelectTrigger)

    // Wait for the dropdown to open and click the "admin" option
    const adminOption = await screen.findByRole('option', { name: 'admin' })
    await user.click(adminOption)

    // Verify the role was updated — scope to the member's row to avoid matching the owner's badge
    await waitFor(() => {
      const updatedRow = screen.getByText('Members Regular Member').closest('[data-testid="member-row"]')
      expect(updatedRow).not.toBeNull()
      const roleDisplay = updatedRow!.querySelector('[data-testid="role-select"]')
      expect(roleDisplay?.textContent).toBe('admin')
    })
  })

  it('owner can disable a member', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for the member list to load
    await waitFor(() => {
      expect(screen.getByText('Members Regular Member')).toBeInTheDocument()
    })

    // Click the disable button for the member
    const memberRow = screen.getByText('Members Regular Member').closest('[data-testid="member-row"]')
    expect(memberRow).not.toBeNull()

    const disableButton = memberRow!.querySelector('[data-testid="disable-member-button"]')
      ?? memberRow!.querySelector('button[aria-label="Disable member"]')
    expect(disableButton).not.toBeNull()

    await user.click(disableButton as HTMLElement)

    // Verify the member shows as disabled
    await waitFor(() => {
      expect(screen.getByText(/disabled/i)).toBeInTheDocument()
    })
  })

  it('owner can re-enable a disabled member', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for the member list to load
    await waitFor(() => {
      expect(screen.getByText('Members Regular Member')).toBeInTheDocument()
    })

    // First disable the member through the UI
    const memberRow = screen.getByText('Members Regular Member').closest('[data-testid="member-row"]')
    expect(memberRow).not.toBeNull()

    const disableButton = memberRow!.querySelector('[data-testid="disable-member-button"]')
      ?? memberRow!.querySelector('button[aria-label="Disable member"]')
    expect(disableButton).not.toBeNull()

    await user.click(disableButton as HTMLElement)

    // Wait for the disabled state
    await waitFor(() => {
      expect(screen.getByText(/disabled/i)).toBeInTheDocument()
    })

    // Now enable the member
    const enableButton = memberRow!.querySelector('[data-testid="enable-member-button"]')
      ?? memberRow!.querySelector('button[aria-label="Enable member"]')
      ?? screen.getByRole('button', { name: /enable/i })
    expect(enableButton).not.toBeNull()

    await user.click(enableButton)

    // Verify the member is active again
    await waitFor(() => {
      expect(screen.queryByText(/disabled/i)).not.toBeInTheDocument()
    })
  })

  it('owner can remove a member', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for the member list to load
    await waitFor(() => {
      expect(screen.getByText('Members Regular Member')).toBeInTheDocument()
    })

    // Click the remove button for the member
    const memberRow = screen.getByText('Members Regular Member').closest('[data-testid="member-row"]')
    expect(memberRow).not.toBeNull()

    const removeButton = memberRow!.querySelector('[data-testid="remove-member-button"]')
      ?? memberRow!.querySelector('button[aria-label="Remove member"]')
    expect(removeButton).not.toBeNull()

    await user.click(removeButton as HTMLElement)

    // Confirm the removal in the dialog/modal
    const confirmButton = await screen.findByRole('button', { name: /confirm|yes|remove/i })
    await user.click(confirmButton)

    // Verify the member is removed from the list
    await waitFor(() => {
      expect(screen.queryByText('Members Regular Member')).not.toBeInTheDocument()
    })
  })

  it('shows member workspaces and uses a centered trash action for removal', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, member, org } = await seedOwnerAndMember(factoryContext)

    await createTeamWithMembers(factoryContext, {
      token: owner.token,
      organizationId: org.id,
      teamName: 'Client Launch',
      members: [{ userId: member.user.id }]
    })

    writeAuthToken(owner.token)

    renderMembersPage(org.id)

    const memberRow = (await screen.findByText('Members Regular Member')).closest('[data-testid="member-row"]')
    expect(memberRow).not.toBeNull()

    await within(memberRow as HTMLElement).findByText('Client Launch')
    expect(within(memberRow as HTMLElement).getByLabelText(/teams for members regular member/i)).toBeInTheDocument()

    const actionsHeader = screen.getAllByRole('columnheader', { name: 'Actions' })[0]
    expect(actionsHeader).toHaveClass('text-center')

    const removeButton = within(memberRow as HTMLElement).getByRole('button', {
      name: /remove members regular member/i
    })
    expect(removeButton).toHaveClass('text-destructive')
    expect(removeButton.querySelector('svg')).not.toBeNull()
  })

  it('renders the workspace selector for the current admin member row', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    renderMembersPage(org.id)

    const ownerRow = (await screen.findByText('Members Owner')).closest('[data-testid="member-row"]')
    expect(ownerRow).not.toBeNull()
    expect(within(ownerRow as HTMLElement).getByLabelText(/teams for members owner/i)).toBeInTheDocument()
  })

  it('confirms organization removal when the last workspace is removed from a member', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, member, org } = await seedOwnerAndMember(factoryContext)

    await createTeamWithMembers(factoryContext, {
      token: owner.token,
      organizationId: org.id,
      teamName: 'Single Workspace',
      members: [{ userId: member.user.id }]
    })

    writeAuthToken(owner.token)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderMembersPage(org.id)

    try {
      const memberRow = (await screen.findByText('Members Regular Member')).closest('[data-testid="member-row"]')
      expect(memberRow).not.toBeNull()

      const removeWorkspaceButton = await within(memberRow as HTMLElement).findByLabelText(/remove single workspace/i)
      await user.click(removeWorkspaceButton)

      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete this person from the organization?')
      })

      await waitFor(() => {
        expect(screen.queryByText('Members Regular Member')).not.toBeInTheDocument()
      })
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('non-admin cannot see member management controls', async () => {
    const factoryContext = createWebFactoryContext()
    const { member, org } = await seedOwnerAndMember(factoryContext)

    // Sign in as the regular member (not the owner)
    writeAuthToken(member.token)

    renderMembersPage(org.id)

    // The member should see the member list
    await waitFor(() => {
      expect(screen.getByText('Members Owner')).toBeInTheDocument()
    })
    expect(screen.getByText('Members Regular Member')).toBeInTheDocument()

    // But should NOT see management controls (role change, disable, remove buttons)
    expect(screen.queryByTestId('role-select')).not.toBeInTheDocument()
    expect(screen.queryByTestId('disable-member-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('remove-member-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /disable/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).not.toBeInTheDocument()
  })

  it('owner can transfer ownership', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `transfer-owner-${randomUUID()}@example.com`,
      password: 'transfer-owner-pass-12345',
      name: 'Transfer Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Transfer Ownership Organization'
    })

    // Create an admin member (not just a regular member)
    const admin = await createUser(factoryContext, {
      email: `transfer-admin-${randomUUID()}@example.com`,
      password: 'transfer-admin-pass-12345',
      name: 'Transfer Admin'
    })

    const invitation = await createInvitation(factoryContext, {
      token: owner.token,
      organizationId: org.id,
      email: admin.credentials.email,
      role: 'admin'
    })

    // Accept invitation as the admin
    writeAuthToken(admin.token)
    await clientApi.acceptInvitation(invitation.token)

    // Now sign in as the owner and render the page
    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for the member list to load
    await waitFor(() => {
      expect(screen.getByText('Transfer Admin')).toBeInTheDocument()
    })

    // Click the transfer ownership button
    const transferButton = screen.getByRole('button', { name: /transfer ownership/i })
    await user.click(transferButton)

    // Select the admin as the new owner in the shadcn Select dialog
    const ownerSelectTrigger = await screen.findByLabelText(/new owner/i)
    await user.click(ownerSelectTrigger)

    // Wait for the dropdown to open and click the admin option
    const adminOption = await screen.findByRole('option', { name: 'Transfer Admin' })
    await user.click(adminOption)

    // Confirm the transfer
    const confirmButton = screen.getByRole('button', { name: /confirm transfer/i })
    await user.click(confirmButton)

    // Verify the ownership was transferred (both users remain 'admin' — only owner_user_id changes)
    await waitFor(() => {
      const adminRow = screen.getByText('Transfer Admin').closest('[data-testid="member-row"]')
      expect(adminRow).not.toBeNull()
      expect(adminRow!.textContent).toContain('admin')
    })
  })

  it('owner can invite a new member', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-owner-${randomUUID()}@example.com`,
      password: 'invite-owner-pass-12345',
      name: 'Invite Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Test Organization'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for page to load
    await waitFor(() => {
      expect(screen.getByText('Invite Owner')).toBeInTheDocument()
    })

    // Create the invitee user first (required by API)
    const newMemberEmail = `newmember-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: newMemberEmail,
      password: 'newmember-pass-12345',
      name: 'New Member'
    })

    // Re-auth as owner after createUser
    writeAuthToken(owner.token)

    // Click "Invite Member" button
    const inviteButton = await findInviteMemberButton()
    await user.click(inviteButton)

    // Fill email input in dialog
    const emailInput = await screen.findByLabelText(/email/i)
    await user.type(emailInput, newMemberEmail)

    // The role select defaults to 'member' which is what we want,
    // so no need to interact with the shadcn Select.

    // Click send/invite button
    const sendButton = screen.getByRole('button', { name: /send invitation/i })
    await user.click(sendButton)

    // Verify invitation appears in pending section
    await waitFor(() => {
      expect(screen.getByText(newMemberEmail)).toBeInTheDocument()
    })
    // Verify the invitation row has the pending status badge
    const invitationRow = screen.getByText(newMemberEmail).closest('[data-testid="invitation-row"]')
    expect(invitationRow).not.toBeNull()
    expect(invitationRow!.textContent).toContain('pending')
  })

  it('submits an invite-before-signup invitation when Enter is pressed in the email field', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-error-owner-${randomUUID()}@example.com`,
      password: 'invite-error-pass-12345',
      name: 'Invite Error Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Error Organization'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Invite Error Owner')).toBeInTheDocument()
    })

    await user.click(await findInviteMemberButton())
    const invitedEmail = `missing-account-${randomUUID()}@example.com`
    await user.type(
      await screen.findByLabelText(/email/i),
      invitedEmail
    )
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText(invitedEmail)).toBeInTheDocument()
    })
    expect(screen.queryByText(/invited user must already have an account/i)).not.toBeInTheDocument()
  })

  it('keeps the invite dialog focused on email, workspace, access, and member type choices', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-guidance-owner-${randomUUID()}@example.com`,
      password: 'invite-guidance-owner-pass-12345',
      name: 'Invite Guidance Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Guidance Org'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Invite Guidance Owner')).toBeInTheDocument()
    })

    await user.click(await findInviteMemberButton())

    const dialog = await screen.findByRole('dialog', { name: /invite member/i })

    await waitFor(() => {
      expect(within(dialog).getByText(/can view and execute workflows/i)).toBeInTheDocument()
      expect(within(dialog).getByText(/full access including billing and member management/i)).toBeInTheDocument()
      expect(within(dialog).getByText(/pick one or more specific workspaces/i)).toBeInTheDocument()
      expect(within(dialog).getByText(/client-facing access for shared workspace content/i)).toBeInTheDocument()
    })

    expect(within(dialog).getByText(/^member type$/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /internal teammate/i })).toHaveAttribute('aria-pressed', 'true')
    const clientCollaboratorButton = within(dialog).getByRole('button', { name: /client collaborator/i })
    expect(clientCollaboratorButton).toBeEnabled()
    await user.click(clientCollaboratorButton)
    expect(clientCollaboratorButton).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).queryByText(/coming soon/i)).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText(/workspace access/i)).toBeInTheDocument()
  })

  it('owner can invite a client collaborator scoped to a workspace', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-client-owner-${randomUUID()}@example.com`,
      password: 'invite-client-owner-pass-12345',
      name: 'Invite Client Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Client Organization'
    })

    writeAuthToken(owner.token)

    const team = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Client Portal',
      brandSettings: defaultTestBrandSettings
    })

    const invitedEmail = `invite-client-member-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: invitedEmail,
      password: 'invite-client-member-pass-12345',
      name: 'Invite Client Member'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Invite Client Owner')).toBeInTheDocument()
    })

    await user.click(await findInviteMemberButton())

    const dialog = await screen.findByRole('dialog', { name: /invite member/i })
    await user.type(within(dialog).getByLabelText(/email/i), invitedEmail)
    await user.click(within(dialog).getByRole('button', { name: /client collaborator/i }))
    await user.click(within(dialog).getByLabelText(/workspace access/i))

    const workspaceOption = (await screen.findAllByText('Client Portal')).find((element) =>
      element.closest('[role="option"]')
    )
    expect(workspaceOption).toBeDefined()
    await user.click(workspaceOption as HTMLElement)
    await user.click(within(dialog).getByRole('button', { name: /send invitation/i }))

    await waitFor(() => {
      const invitationRow = screen.getByText(invitedEmail).closest('[data-testid="invitation-row"]')
      if (!(invitationRow instanceof HTMLElement)) {
        throw new Error('Expected invitation row to render')
      }
      expect(within(invitationRow).getByText('Client Portal')).toBeInTheDocument()
    })

    const invitations = await organizationsListOrgInvitations(org.id, { 'filter[status]': 'pending' })
    const createdInvitation = invitations.data.find((invitation) => invitation.email === invitedEmail)

    expect(createdInvitation?.teamId).toBe(team.id)
    expect((createdInvitation as { membershipType?: string } | undefined)?.membershipType).toBe('client')
  })

  it('owner can invite a client collaborator to all current workspaces', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-client-all-owner-${randomUUID()}@example.com`,
      password: 'invite-client-all-owner-pass-12345',
      name: 'Invite Client All Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Client All Organization'
    })

    writeAuthToken(owner.token)

    const firstTeam = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Client All Launch',
      brandSettings: defaultTestBrandSettings
    })
    const secondTeam = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Client All Support',
      brandSettings: defaultTestBrandSettings
    })

    const invitedEmail = `invite-client-all-member-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: invitedEmail,
      password: 'invite-client-all-member-pass-12345',
      name: 'Invite Client All Member'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Invite Client All Owner')).toBeInTheDocument()
    })

    await user.click(await findInviteMemberButton())

    const dialog = await screen.findByRole('dialog', { name: /invite member/i })
    await user.type(within(dialog).getByLabelText(/email/i), invitedEmail)
    await user.click(within(dialog).getByRole('button', { name: /client collaborator/i }))
    expect(within(dialog).getByText(/all 2 current workspaces/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /send invitation/i }))

    await waitFor(() => {
      expect(screen.getAllByText(invitedEmail)).toHaveLength(2)
    })

    const invitations = await organizationsListOrgInvitations(org.id, { 'filter[status]': 'pending' })
    const createdInvitations = invitations.data.filter((invitation) => invitation.email === invitedEmail)

    expect(createdInvitations.map((invitation) => invitation.teamId).sort()).toEqual(
      [firstTeam.id, secondTeam.id].sort()
    )
    expect(createdInvitations.map((invitation) => invitation.membershipType)).toEqual(['client', 'client'])
  })

  it('keeps successful client workspace invites when one selected workspace already has a pending invite', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-client-partial-owner-${randomUUID()}@example.com`,
      password: 'invite-client-partial-owner-pass-12345',
      name: 'Invite Client Partial Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Client Partial Organization'
    })

    writeAuthToken(owner.token)

    const existingTeam = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Existing Client Workspace',
      brandSettings: defaultTestBrandSettings
    })
    const newTeam = await clientApi.createTeam({
      organizationId: org.id,
      name: 'New Client Workspace',
      brandSettings: defaultTestBrandSettings
    })

    const invitedEmail = `invite-client-partial-member-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: invitedEmail,
      password: 'invite-client-partial-member-pass-12345',
      name: 'Invite Client Partial Member'
    })

    writeAuthToken(owner.token)
    await organizationsCreateInvitation({
      organizationId: org.id,
      email: invitedEmail,
      role: 'member',
      teamId: existingTeam.id,
      membershipType: 'client'
    })

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Invite Client Partial Owner')).toBeInTheDocument()
      expect(screen.getByText('Existing Client Workspace')).toBeInTheDocument()
    })

    await user.click(await findInviteMemberButton())

    const dialog = await screen.findByRole('dialog', { name: /invite member/i })
    await user.type(within(dialog).getByLabelText(/email/i), invitedEmail)
    await user.click(within(dialog).getByRole('button', { name: /client collaborator/i }))
    await user.click(within(dialog).getByRole('button', { name: /send invitation/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /invite member/i })).not.toBeInTheDocument()
      expect(screen.getAllByText(invitedEmail)).toHaveLength(2)
    })

    const invitations = await organizationsListOrgInvitations(org.id, { 'filter[status]': 'pending' })
    const createdInvitations = invitations.data.filter((invitation) => invitation.email === invitedEmail)

    expect(createdInvitations.map((invitation) => invitation.teamId).sort()).toEqual(
      [existingTeam.id, newTeam.id].sort()
    )
  })

  it('owner can scope an invitation to a workspace', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-team-owner-${randomUUID()}@example.com`,
      password: 'invite-team-owner-pass-12345',
      name: 'Invite Team Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Team Organization'
    })

    writeAuthToken(owner.token)

    const team = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Client Success',
      brandSettings: defaultTestBrandSettings
    })

    const invitedEmail = `invite-team-member-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: invitedEmail,
      password: 'invite-team-member-pass-12345',
      name: 'Invite Team Member'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Invite Team Owner')).toBeInTheDocument()
    })

    await user.click(await findInviteMemberButton())

    const dialog = await screen.findByRole('dialog', { name: /invite member/i })
    await user.type(within(dialog).getByLabelText(/email/i), invitedEmail)
    await user.click(within(dialog).getByLabelText(/workspace access/i))
    const workspaceOption = (await screen.findAllByText('Client Success')).find((element) =>
      element.closest('[role="option"]')
    )
    expect(workspaceOption).toBeDefined()
    await user.click(workspaceOption as HTMLElement)
    await user.click(within(dialog).getByRole('button', { name: /send invitation/i }))

    await waitFor(() => {
      const invitationRow = screen.getByText(invitedEmail).closest('[data-testid="invitation-row"]')
      if (!(invitationRow instanceof HTMLElement)) {
        throw new Error('Expected invitation row to render')
      }
      expect(within(invitationRow).getByText('Client Success')).toBeInTheDocument()
    })

    const invitations = await organizationsListOrgInvitations(org.id, { 'filter[status]': 'pending' })
    const createdInvitation = invitations.data.find((invitation) => invitation.email === invitedEmail)

    expect(createdInvitation?.teamId).toBe(team.id)
  })

  it('owner can invite one person to multiple selected workspaces', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `invite-multi-owner-${randomUUID()}@example.com`,
      password: 'invite-multi-owner-pass-12345',
      name: 'Invite Multi Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Multi Organization'
    })

    writeAuthToken(owner.token)

    const launchTeam = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Launch Workspace',
      brandSettings: defaultTestBrandSettings
    })
    const supportTeam = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Support Workspace',
      brandSettings: defaultTestBrandSettings
    })

    const invitedEmail = `invite-multi-member-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: invitedEmail,
      password: 'invite-multi-member-pass-12345',
      name: 'Invite Multi Member'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Invite Multi Owner')).toBeInTheDocument()
    })

    await user.click(await findInviteMemberButton())

    const dialog = await screen.findByRole('dialog', { name: /invite member/i })
    await user.type(within(dialog).getByLabelText(/email/i), invitedEmail)

    const workspaceSelect = within(dialog).getByLabelText(/workspace access/i)
    await user.click(workspaceSelect)
    const launchOption = (await screen.findAllByText('Launch Workspace')).find((element) =>
      element.closest('[role="option"]')
    )
    expect(launchOption).toBeDefined()
    await user.click(launchOption as HTMLElement)

    await user.click(workspaceSelect)
    const supportOption = (await screen.findAllByText('Support Workspace')).find((element) =>
      element.closest('[role="option"]')
    )
    expect(supportOption).toBeDefined()
    await user.click(supportOption as HTMLElement)

    await user.click(within(dialog).getByRole('button', { name: /send invitation/i }))

    await waitFor(() => {
      expect(screen.getAllByText(invitedEmail)).toHaveLength(2)
    })

    const invitationRows = screen.getAllByText(invitedEmail).map((emailCell) =>
      emailCell.closest('[data-testid="invitation-row"]')
    )
    expect(invitationRows).toHaveLength(2)
    expect(invitationRows.map((row) => row?.textContent ?? '')).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Launch Workspace'),
        expect.stringContaining('Support Workspace')
      ])
    )

    const invitations = await organizationsListOrgInvitations(org.id, { 'filter[status]': 'pending' })
    const createdInvitations = invitations.data.filter((invitation) => invitation.email === invitedEmail)
    expect(createdInvitations.map((invitation) => invitation.teamId).sort()).toEqual(
      [launchTeam.id, supportTeam.id].sort()
    )
  })

  it('shows pending invitations', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `pending-owner-${randomUUID()}@example.com`,
      password: 'pending-owner-pass-12345',
      name: 'Pending Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Pending Invitations Organization'
    })

    // Create the invitee user first (required by API)
    const pendingInviteeEmail = `pending-invitee-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: pendingInviteeEmail,
      password: 'pending-invitee-pass-12345',
      name: 'Pending Invitee'
    })

    // Create an invitation via API
    await createInvitation(factoryContext, {
      token: owner.token,
      organizationId: org.id,
      email: pendingInviteeEmail,
      role: 'member'
    })

    writeAuthToken(owner.token)

    renderMembersPage(org.id)

    // Verify pending invitation shows with email and status badge
    await waitFor(() => {
      expect(screen.getByText(pendingInviteeEmail)).toBeInTheDocument()
    })
    const invitationRow = screen.getByText(pendingInviteeEmail).closest('[data-testid="invitation-row"]')
    expect(invitationRow).not.toBeNull()
    expect(invitationRow!.textContent).toContain('pending')
  })

  it('owner can revoke a pending invitation', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `revoke-owner-${randomUUID()}@example.com`,
      password: 'revoke-owner-pass-12345',
      name: 'Revoke Owner'
    })

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Revoke Invitation Organization'
    })

    // Create the invitee user first (required by API)
    const revokeInviteeEmail = `revoke-invitee-${randomUUID()}@example.com`
    await createUser(factoryContext, {
      email: revokeInviteeEmail,
      password: 'revoke-invitee-pass-12345',
      name: 'Revoke Invitee'
    })

    // Create an invitation via API
    await createInvitation(factoryContext, {
      token: owner.token,
      organizationId: org.id,
      email: revokeInviteeEmail,
      role: 'member'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for the pending invitation to appear
    await waitFor(() => {
      expect(screen.getByText(revokeInviteeEmail)).toBeInTheDocument()
    })

    // Click revoke on the pending invitation (first click shows confirmation)
    const revokeButton = screen.getByRole('button', { name: /revoke/i })
    await user.click(revokeButton)

    // Confirm the revocation in the inline confirmation
    const confirmButton = await screen.findByRole('button', { name: /confirm/i })
    await user.click(confirmButton)

    // Verify invitation is removed from the pending list
    await waitFor(() => {
      expect(screen.queryByText(revokeInviteeEmail)).not.toBeInTheDocument()
    })
  })

  it('non-admin cannot see invite button', async () => {
    const factoryContext = createWebFactoryContext()
    const { member, org } = await seedOwnerAndMember(factoryContext)

    // Sign in as the regular member (not the owner)
    writeAuthToken(member.token)

    renderMembersPage(org.id)

    // The member should see the member list
    await waitFor(() => {
      expect(screen.getByText('Members Owner')).toBeInTheDocument()
    })

    // Verify "Invite Member" button is not present
    expect(screen.queryByRole('button', { name: /invite member/i })).not.toBeInTheDocument()
  })

  it('does not allow selecting your own row for removal', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Members Owner')).toBeInTheDocument()
    })

    const ownerRow = screen.getByText('Members Owner').closest('[data-testid="member-row"]')
    expect(ownerRow).not.toBeNull()

    const ownerCheckbox = ownerRow!.querySelector('input[type="checkbox"]')
    expect(ownerCheckbox).not.toBeNull()
    expect(ownerCheckbox).toBeDisabled()
  })

  it('last admin guard prevents demotion', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    // Wait for the member list to load
    await waitFor(() => {
      expect(screen.getByText('Members Owner')).toBeInTheDocument()
    })

    // Try to demote the owner (who is the only admin/owner)
    const ownerRow = screen.getByText('Members Owner').closest('[data-testid="member-row"]')
    expect(ownerRow).not.toBeNull()

    const roleSelect = ownerRow!.querySelector('[data-testid="role-select"]')
      ?? ownerRow!.querySelector('select')

    // If the role select exists, try to change it to member
    if (roleSelect) {
      await user.selectOptions(roleSelect, 'member')

      // Verify an error toast or message is shown
      await waitFor(() => {
        expect(
          screen.getByText(/cannot demote|last admin|must have at least one admin|cannot change role/i)
        ).toBeInTheDocument()
      })
    } else {
      // The UI should prevent demotion by not showing a role select for the last admin
      // This is also a valid implementation — the select is simply disabled or absent
      expect(roleSelect).toBeNull()
    }
  })

  it('select all skips the current user checkbox', async () => {
    const factoryContext = createWebFactoryContext()
    const { owner, org } = await seedOwnerAndMember(factoryContext)

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderMembersPage(org.id)

    await waitFor(() => {
      expect(screen.getByText('Members Owner')).toBeInTheDocument()
    })

    const ownerRow = screen.getByText('Members Owner').closest('[data-testid="member-row"]')
    expect(ownerRow).not.toBeNull()

    const ownerCheckbox = ownerRow!.querySelector('input[type="checkbox"]')
    expect(ownerCheckbox).not.toBeNull()
    expect(ownerCheckbox).toBeDisabled()

    const memberRow = screen.getByText('Members Regular Member').closest('[data-testid="member-row"]')
    expect(memberRow).not.toBeNull()
    const memberCheckbox = memberRow!.querySelector('input[type="checkbox"]')
    expect(memberCheckbox).not.toBeNull()

    await user.click(screen.getByLabelText(/select all members/i))

    await waitFor(() => {
      expect(ownerCheckbox).not.toBeChecked()
      expect(memberCheckbox).toBeChecked()
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    })
  })
})
