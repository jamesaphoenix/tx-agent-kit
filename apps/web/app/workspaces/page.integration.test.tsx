import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import WorkspacesPage from './page'
import { mockRouter } from '../../integration/mocks/next-navigation'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'
import { renderWithProviders, screen, waitFor } from '../../integration/test-utils'

describe('WorkspacesPage integration', () => {
  it('redirects to sign-in when no auth token is present', async () => {
    renderWithProviders(<WorkspacesPage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in?next=%2Fworkspaces')
    })
  })

  it('loads authenticated workspace data', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'workspaces-owner@example.com',
      password: 'workspaces-owner-pass-12345',
      name: 'Workspaces Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Workspaces Integration Team'
    })

    writeAuthToken(owner.token)

    renderWithProviders(<WorkspacesPage />)

    await waitFor(() => {
      expect(screen.getByText('Your workspaces')).toBeInTheDocument()
    })

    expect(await screen.findByText(workspace.name)).toBeInTheDocument()
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/sign-in?next=%2Fworkspaces')
  })

  it('redirects to sign-in and clears session when auth token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<WorkspacesPage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in?next=%2Fworkspaces')
    })

    expect(readAuthToken()).toBeNull()
  })
})
