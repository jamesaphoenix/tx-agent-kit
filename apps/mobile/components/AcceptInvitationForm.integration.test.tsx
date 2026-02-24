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

describe('AcceptInvitationForm integration', () => {
  it('accepts invitation tokens and grants workspace membership once', async () => {
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

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: `Mobile Accept Workspace ${randomUUID()}`
    })

    const createInvitationResponse = await fetch(`${mobileIntegrationBaseUrl}/v1/invitations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        workspaceId: workspace.id,
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
          FROM workspace_members
          WHERE workspace_id = $1
            AND user_id = $2
        `,
        [workspace.id, invitee.user.id]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(membershipCount).toBe(1)
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })
})
