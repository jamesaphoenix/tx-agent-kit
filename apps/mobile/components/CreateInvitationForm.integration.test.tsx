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

describe('CreateInvitationForm integration', () => {
  it('creates pending invitations for existing users in a real workspace', async () => {
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

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: `Mobile Invite Workspace ${randomUUID()}`
    })

    await writeAuthToken(owner.token)

    const onCreated = vi.fn()
    const tree = create(
      <CreateInvitationForm
        workspaces={[{ id: workspace.id, name: workspace.name }]}
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
          WHERE workspace_id = $1
            AND email = $2
            AND status = 'pending'
        `,
        [workspace.id, invitee.user.email]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(invitationCount).toBe(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})
