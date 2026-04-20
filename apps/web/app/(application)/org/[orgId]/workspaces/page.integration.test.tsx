import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import WorkspacesPage from '@/app/(application)/org/[orgId]/workspaces/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/integration/test-utils'
import { writeAuthToken } from '@/lib/auth-token'

function renderWorkspacesPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <WorkspacesPage />
    </PathParamsContext.Provider>
  )
}

describe('WorkspacesPage integration', () => {
  it('opens the shared create workspace dialog and creates a workspace when Enter is pressed', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `workspace-enter-owner-${randomUUID()}@example.com`,
      password: 'workspace-enter-owner-pass-12345',
      name: 'Workspace Enter Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Workspace Enter Organization'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderWorkspacesPage(organization.id)

    const workspaceName = `Keyboard Workspace ${randomUUID().slice(0, 8)}`
    await user.click(await screen.findByRole('button', { name: 'Create workspace' }))

    const dialog = await screen.findByRole('dialog', { name: 'Create workspace' })
    expect(within(dialog).getByText('Brand palette')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New workspace' })).not.toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Workspace name'), workspaceName)
    await user.type(within(dialog).getByLabelText('Website'), 'example.com')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getAllByText(workspaceName).length).toBeGreaterThanOrEqual(1)
    })
    expect(await screen.findByText('https://example.com')).toBeInTheDocument()
  })
})
