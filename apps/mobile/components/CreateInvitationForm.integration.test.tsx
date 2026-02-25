import React from 'react'
import { randomUUID } from 'node:crypto'
import { create, act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createTeam, createUser } from '../../../packages/testkit/src/index.ts'
import { createMobileFactoryContext } from '../integration/support/mobile-integration-context'
import { waitFor } from '../integration/support/wait-for'
import { writeAuthToken } from '../lib/auth-token'
import { CreateInvitationForm } from './CreateInvitationForm'

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

describe('CreateInvitationForm integration', () => {
  it('creates pending invitations for existing users in a real organization', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-invite-owner-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-invite-target-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Target'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    await writeAuthToken(owner.token)

    const onCreated = vi.fn()
    const tree = create(
      <CreateInvitationForm
        organizations={[{ id: organization.id, name: organization.name }]}
        onCreated={onCreated}
      />
    )

    const emailInput = findByType(tree.root, 'TextInput').find(
      (input) => input.props.placeholder === 'teammate@company.com'
    )

    await act(async () => {
      emailInput?.props.onChangeText(invitee.user.email)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity').at(-1)?.props.onPress()
    })

    await waitFor(() => onCreated.mock.calls.length === 1)

    const invitationCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM invitations
          WHERE organization_id = $1
            AND email = $2
            AND status = 'pending'
        `,
        [organization.id, invitee.user.email]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(invitationCount).toBe(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error and does not create invitations when unauthenticated', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-invite-unauth-owner-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Unauth Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-invite-unauth-target-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Unauth Target'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    const onCreated = vi.fn()
    const tree = create(
      <CreateInvitationForm
        organizations={[{ id: organization.id, name: organization.name }]}
        onCreated={onCreated}
      />
    )

    const emailInput = findByType(tree.root, 'TextInput').find(
      (input) => input.props.placeholder === 'teammate@company.com'
    )

    await act(async () => {
      emailInput?.props.onChangeText(invitee.user.email)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity').at(-1)?.props.onPress()
    })

    await waitFor(() =>
      hasText(tree.root, /failed to send invitation|unauthorized|authentication|missing authorization/i)
    )

    const invitationCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM invitations
          WHERE organization_id = $1
            AND email = $2
        `,
        [organization.id, invitee.user.email]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(invitationCount).toBe(0)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('rejects invitations for non-organization members and keeps storage unchanged', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-invite-owner-forbidden-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Owner Forbidden'
    })

    const outsider = await createUser(factoryContext, {
      email: `mobile-invite-outsider-forbidden-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Outsider Forbidden'
    })

    const invitee = await createUser(factoryContext, {
      email: `mobile-invite-target-forbidden-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Target Forbidden'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    await writeAuthToken(outsider.token)

    const onCreated = vi.fn()
    const tree = create(
      <CreateInvitationForm
        organizations={[{ id: organization.id, name: organization.name }]}
        onCreated={onCreated}
      />
    )

    const emailInput = findByType(tree.root, 'TextInput').find(
      (input) => input.props.placeholder === 'teammate@company.com'
    )

    await act(async () => {
      emailInput?.props.onChangeText(invitee.user.email)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity').at(-1)?.props.onPress()
    })

    const readInvitationCount = async (): Promise<number> =>
      factoryContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ count: string | number }>(
          `
            SELECT COUNT(*)::int AS count
            FROM invitations
            WHERE organization_id = $1
              AND email = $2
          `,
          [organization.id, invitee.user.email]
        )

        const rawCount = result.rows[0]?.count
        return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
      })

    let invitationCount = -1
    await waitFor(async () => {
      invitationCount = await readInvitationCount()
      return invitationCount === 0
    })


    expect(invitationCount).toBe(0)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('surfaces an error when inviting an email without an existing account', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-invite-owner-unknown-email-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invite Owner Unknown Email'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: organizationName()
    })

    await writeAuthToken(owner.token)

    const unknownEmail = `mobile-unknown-email-${randomUUID()}@example.com`
    const onCreated = vi.fn()
    const tree = create(
      <CreateInvitationForm
        organizations={[{ id: organization.id, name: organization.name }]}
        onCreated={onCreated}
      />
    )

    const emailInput = findByType(tree.root, 'TextInput').find(
      (input) => input.props.placeholder === 'teammate@company.com'
    )

    await act(async () => {
      emailInput?.props.onChangeText(unknownEmail)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity').at(-1)?.props.onPress()
    })

    await waitFor(() =>
      hasText(tree.root, /failed to send invitation|must already have an account|invalid/i)
    )

    const invitationCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM invitations
          WHERE organization_id = $1
            AND email = $2
        `,
        [organization.id, unknownEmail]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(invitationCount).toBe(0)
    expect(onCreated).not.toHaveBeenCalled()
  })
})
