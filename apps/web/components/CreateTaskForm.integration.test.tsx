import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import { CreateTaskForm } from './CreateTaskForm'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

describe('CreateTaskForm integration', () => {
  it('creates a task for an existing workspace through the web form', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'task-owner@example.com',
      password: 'task-pass-12345',
      name: 'Task Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Task Workspace'
    })

    writeAuthToken(owner.token)

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<CreateTaskForm workspaceId={workspace.id} onCreated={onCreated} />)

    await user.type(screen.getByPlaceholderText('Ship invitation acceptance flow'), 'Integration task title')
    await user.type(screen.getByPlaceholderText('Optional context'), 'Integration task description')
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })

    const tasks = await clientApi.listTasks(workspace.id)
    expect(tasks.tasks).toHaveLength(1)
    expect(tasks.tasks[0]?.title).toBe('Integration task title')
  })
})
