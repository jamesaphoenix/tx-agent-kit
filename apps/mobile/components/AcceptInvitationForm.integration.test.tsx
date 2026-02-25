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

    const tokenInput = findByType(tree.root, 'TextInput')[0]
    await act(async () => {
      tokenInput?.props.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
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

    const tokenInput = findByType(tree.root, 'TextInput')[0]
    await act(async () => {
      tokenInput?.props.onChangeText(`${createdInvitation.token}-invalid`)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
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

    const tokenInput = findByType(tree.root, 'TextInput')[0]
    await act(async () => {
      tokenInput?.props.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
    })

    await waitFor(() => onAccepted.mock.calls.length === 1)

    await act(async () => {
      tokenInput?.props.onChangeText(createdInvitation.token)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
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
})
