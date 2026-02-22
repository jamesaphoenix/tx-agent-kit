import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import DashboardPage from './page'
import { mockRouter } from '../../integration/mocks/next-navigation'
import { renderWithProviders, screen, waitFor } from '../../integration/test-utils'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'

describe('DashboardPage integration', () => {
  it('redirects to sign-in when no auth token is present', async () => {
    renderWithProviders(<DashboardPage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
    })
  })

  it('loads current user, workspace, and tasks when authenticated', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'dashboard-owner@example.com',
      password: 'dashboard-owner-pass-12345',
      name: 'Dashboard Owner'
    })

    const workspace = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Dashboard Workspace'
    })

    writeAuthToken(owner.token)

    await clientApi.createTask({
      workspaceId: workspace.id,
      title: 'Agent task from dashboard test',
      description: 'Dashboard integration flow'
    })

    renderWithProviders(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(`Signed in as ${owner.user.email}`)).toBeInTheDocument()
    })

    expect(await screen.findByText('Dashboard Workspace')).toBeInTheDocument()
    expect(await screen.findByText('Agent task from dashboard test')).toBeInTheDocument()
  })

  it('redirects to sign-in and clears session when auth token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<DashboardPage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
    })

    expect(readAuthToken()).toBeNull()
  })
})
