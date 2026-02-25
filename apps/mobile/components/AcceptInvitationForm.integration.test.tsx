import React from 'react'
import { randomUUID } from 'node:crypto'
import { create, act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createTeam, createUser } from '../../../packages/testkit/src/index.ts'
import {
  createMobileFactoryContext,
  mobileIntegrationBaseUrl
} from '../integration/support/mobile-integration-context'
import { waitFor } from '../integration/support/wait-for'
import { writeAuthToken } from '../lib/auth-token'
import { AcceptInvitationForm } from './AcceptInvitationForm'

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

const findTokenInput = (
  root: ReturnType<typeof create>['root']
): { onChangeText: (value: string) => void } => {
  const input = findByType(root, 'TextInput').find(
    (node) => node.props.placeholder === 'Paste invitation token'
  )
  if (!input) {
    throw new Error('Expected invitation token TextInput to be rendered')
  }

  const onChangeText = input.props.onChangeText
  if (typeof onChangeText !== 'function') {
    throw new Error('Expected invitation token TextInput to expose onChangeText handler')
  }

  return { onChangeText: onChangeText as (value: string) => void }
}

const findAcceptButton = (
  root: ReturnType<typeof create>['root']
): { onPress: () => void } => {
  const button = findByType(root, 'TouchableOpacity').find(
    (node) => node.props.accessibilityLabel === 'Accept invitation'
  )
  if (!button) {
    throw new Error('Expected accept invitation button to be rendered')
  }

  const onPress = button.props.onPress
  if (typeof onPress !== 'function') {
    throw new Error('Expected accept invitation button to expose onPress handler')
  }

  return { onPress: onPress as () => void }
}

const organizationName = (): string => `Org ${randomUUID().slice(0, 8)}`

const hasText = (
  root: ReturnType<typeof create>['root'],
  pattern: RegExp
): boolean =>
  findByType(root, 'Text').some((textNode) => {
    const children = textNode.props.children
    const content = Array.isArray(children) ? children.join('') : String(children ?? '')
    return pattern.test(content)
  })

describe('AcceptInvitationForm integration', () => {
  it('accepts invitation tokens and grants organization membership once', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-accept-owner-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-accept-invitee-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Invitee'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    const createInvitationResponse = await fetch(`${mobileIntegrationBaseUrl}/v1/invitations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        organizationId: organization.id,
        email: invitee.user.email,
        role: 'member'
      })
    })

    expect(createInvitationResponse.status).toBe(201)
    const createdInvitation = await createInvitationResponse.json() as {
      token: string
    }

    await writeAuthToken(invitee.token)

    const onAccepted = vi.fn()
    const tree = create(<AcceptInvitationForm onAccepted={onAccepted} />)

    const tokenInput = findTokenInput(tree.root)
    await act(async () => {
      tokenInput.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findAcceptButton(tree.root).onPress()
    })

    await waitFor(() => onAccepted.mock.calls.length === 1)

    const membershipCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM org_members
          WHERE organization_id = $1
            AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(membershipCount).toBe(1)
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error and keeps invitation pending when token is invalid', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-accept-owner-invalid-token-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Owner Invalid Token'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-accept-invitee-invalid-token-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Invitee Invalid Token'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    const createInvitationResponse = await fetch(`${mobileIntegrationBaseUrl}/v1/invitations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        organizationId: organization.id,
        email: invitee.user.email,
        role: 'member'
      })
    })

    expect(createInvitationResponse.status).toBe(201)
    const createdInvitation = await createInvitationResponse.json() as {
      id: string
      token: string
    }

    await writeAuthToken(invitee.token)

    const onAccepted = vi.fn()
    const tree = create(<AcceptInvitationForm onAccepted={onAccepted} />)

    const tokenInput = findTokenInput(tree.root)
    await act(async () => {
      tokenInput.onChangeText(`${createdInvitation.token}-invalid`)
    })

    await act(async () => {
      findAcceptButton(tree.root).onPress()
    })

    await waitFor(() =>
      hasText(tree.root, /failed to accept invitation|not found|invalid|unauthorized/i)
    )

    const invitationStatus = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `
          SELECT status
          FROM invitations
          WHERE id = $1
        `,
        [createdInvitation.id]
      )

      return result.rows[0]?.status ?? null
    })

    const membershipCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM org_members
          WHERE organization_id = $1
            AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(onAccepted).not.toHaveBeenCalled()
    expect(invitationStatus).toBe('pending')
    expect(membershipCount).toBe(0)
  })

  it('surfaces an error and keeps invitation pending when token is accepted by the wrong user', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-accept-owner-wrong-user-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Owner Wrong User'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-accept-invitee-wrong-user-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Invitee Wrong User'
    })

    const attacker = await createUser(factoryContext, {
      email: `mobile-accept-attacker-wrong-user-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Attacker Wrong User'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    const createInvitationResponse = await fetch(`${mobileIntegrationBaseUrl}/v1/invitations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        organizationId: organization.id,
        email: invitee.user.email,
        role: 'member'
      })
    })

    expect(createInvitationResponse.status).toBe(201)
    const createdInvitation = await createInvitationResponse.json() as {
      id: string
      token: string
    }

    await writeAuthToken(attacker.token)

    const onAccepted = vi.fn()
    const tree = create(<AcceptInvitationForm onAccepted={onAccepted} />)

    const tokenInput = findTokenInput(tree.root)
    await act(async () => {
      tokenInput.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findAcceptButton(tree.root).onPress()
    })

    await waitFor(() =>
      hasText(tree.root, /failed to accept invitation|not found|invalid|unauthorized/i)
    )

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
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-accept-owner-reused-token-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Owner Reused Token'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-accept-invitee-reused-token-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Invitee Reused Token'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    const createInvitationResponse = await fetch(`${mobileIntegrationBaseUrl}/v1/invitations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        organizationId: organization.id,
        email: invitee.user.email,
        role: 'member'
      })
    })

    expect(createInvitationResponse.status).toBe(201)
    const createdInvitation = await createInvitationResponse.json() as {
      id: string
      token: string
    }

    await writeAuthToken(invitee.token)

    const onAccepted = vi.fn()
    const tree = create(<AcceptInvitationForm onAccepted={onAccepted} />)

    const tokenInput = findTokenInput(tree.root)
    await act(async () => {
      tokenInput.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findAcceptButton(tree.root).onPress()
    })

    await waitFor(() => onAccepted.mock.calls.length === 1)

    await act(async () => {
      tokenInput.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findAcceptButton(tree.root).onPress()
    })

    await waitFor(() =>
      hasText(tree.root, /failed to accept invitation|not found|expired|invalid/i)
    )

    const invitationStatus = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `
          SELECT status
          FROM invitations
          WHERE id = $1
        `,
        [createdInvitation.id]
      )

      return result.rows[0]?.status ?? null
    })

    const membershipCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM org_members
          WHERE organization_id = $1
            AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(invitationStatus).toBe('accepted')
    expect(membershipCount).toBe(1)
  })

  it('surfaces an error and keeps invitation pending when token is expired', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-accept-owner-expired-token-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Owner Expired Token'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-accept-invitee-expired-token-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Accept Invitee Expired Token'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    const createInvitationResponse = await fetch(`${mobileIntegrationBaseUrl}/v1/invitations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        organizationId: organization.id,
        email: invitee.user.email,
        role: 'member'
      })
    })

    expect(createInvitationResponse.status).toBe(201)
    const createdInvitation = await createInvitationResponse.json() as {
      id: string
      token: string
    }

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

    await writeAuthToken(invitee.token)

    const onAccepted = vi.fn()
    const tree = create(<AcceptInvitationForm onAccepted={onAccepted} />)

    const tokenInput = findTokenInput(tree.root)
    await act(async () => {
      tokenInput.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findAcceptButton(tree.root).onPress()
    })

    await waitFor(() =>
      hasText(tree.root, /failed to accept invitation|not found|expired|invalid/i)
    )

    const invitationStatus = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `
          SELECT status
          FROM invitations
          WHERE id = $1
        `,
        [createdInvitation.id]
      )

      return result.rows[0]?.status ?? null
    })

    const membershipCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM org_members
          WHERE organization_id = $1
            AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(onAccepted).not.toHaveBeenCalled()
    expect(invitationStatus).toBe('pending')
    expect(membershipCount).toBe(0)
  })
})
