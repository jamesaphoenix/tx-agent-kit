import React from 'react'
import { randomUUID } from 'node:crypto'
import { create, act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createUser } from '../../../packages/testkit/src/index.ts'
import { createMobileFactoryContext } from '../integration/support/mobile-integration-context'
import { waitFor } from '../integration/support/wait-for'
import { writeAuthToken } from '../lib/auth-token'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

describe('CreateWorkspaceForm integration', () => {
  it('creates a workspace through the real API and persists it in schema-backed storage', async () => {
    const factoryContext = createMobileFactoryContext()
    const createdUser = await createUser(factoryContext, {
      email: `mobile-workspace-owner-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Workspace Owner'
    })

    await writeAuthToken(createdUser.token)

    const onCreated = vi.fn()
    const workspaceName = `Mobile Workspace ${randomUUID()}`

    const tree = create(<CreateWorkspaceForm onCreated={onCreated} />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input?.props.onChangeText(workspaceName)
    })

    const submitButton = findByType(tree.root, 'TouchableOpacity')[0]
    expect(submitButton?.props.disabled).toBe(false)

    await act(async () => {
      submitButton?.props.onPress()
    })

    await waitFor(() => onCreated.mock.calls.length === 1)

    const workspaceCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM workspaces
          WHERE owner_user_id = $1
            AND name = $2
        `,
        [createdUser.user.id, workspaceName]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(workspaceCount).toBe(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})
