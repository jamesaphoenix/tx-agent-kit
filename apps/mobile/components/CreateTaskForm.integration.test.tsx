import React from 'react'
import { randomUUID } from 'node:crypto'
import { create, act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createTeam, createUser } from '../../../packages/testkit/src/index.ts'
import { createMobileFactoryContext } from '../integration/support/mobile-integration-context'
import { waitFor } from '../integration/support/wait-for'
import { writeAuthToken } from '../lib/auth-token'
import { CreateTaskForm } from './CreateTaskForm'

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

describe('CreateTaskForm integration', () => {
  it('creates tasks against the selected workspace via the real API', async () => {
    const factoryContext = createMobileFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `mobile-task-owner-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Task Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: `Mobile Task Workspace ${randomUUID()}`
    })

    await writeAuthToken(owner.token)

    const title = `Mobile task ${randomUUID()}`
    const description = 'Task created by integration suite'
    const onCreated = vi.fn()

    const tree = create(
      <CreateTaskForm workspaceId={workspace.id} onCreated={onCreated} />
    )

    const titleInput = findByType(tree.root, 'TextInput').find(
      (input) => input.props.placeholder === 'Ship invitation acceptance flow'
    )
    const descriptionInput = findByType(tree.root, 'TextInput').find(
      (input) => input.props.placeholder === 'Optional context'
    )

    await act(async () => {
      titleInput?.props.onChangeText(title)
      descriptionInput?.props.onChangeText(description)
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
    })

    await waitFor(() => onCreated.mock.calls.length === 1)

    const taskCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM tasks
          WHERE workspace_id = $1
            AND title = $2
            AND description = $3
        `,
        [workspace.id, title, description]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(taskCount).toBe(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})
