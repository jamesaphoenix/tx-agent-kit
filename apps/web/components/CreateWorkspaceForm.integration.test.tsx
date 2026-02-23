import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'
import { renderWithProviders, screen, userEvent, waitFor } from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

describe('CreateWorkspaceForm integration', () => {
  it('creates a workspace through the web form', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'workspace-owner@example.com',
      password: 'workspace-pass-12345',
      name: 'Workspace Owner'
    })

    writeAuthToken(owner.token)

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<CreateWorkspaceForm onCreated={onCreated} />)

    await user.type(screen.getByPlaceholderText('Growth Experiments'), 'Integration Workspace')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })

    const workspaces = await clientApi.listWorkspaces()
    expect(workspaces.data.some((workspace) => workspace.name === 'Integration Workspace')).toBe(true)
  })
})
