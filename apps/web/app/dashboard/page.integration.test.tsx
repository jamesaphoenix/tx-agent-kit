import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import DashboardPage from './page'
import { readIntegrationRouterLocation } from '../../integration/support/next-router-context'
import { renderWithProviders, screen, waitFor, within } from '../../integration/test-utils'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'

const dashboardSignInRedirect = '/sign-in?next=%2Fdashboard'

describe('DashboardPage integration', () => {
  it('redirects to sign-in when no auth token is present', async () => {
    renderWithProviders(<DashboardPage />)

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location).toEqual({
        pathname: '/sign-in',
        search: '?next=%2Fdashboard'
      })
      expect(`${location.pathname}${location.search}`).toBe(dashboardSignInRedirect)
    })
  })

  it('loads current user and organization when authenticated', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'dashboard-owner@example.com',
      password: 'dashboard-owner-pass-12345',
      name: 'Dashboard Owner'
    })

    await createTeam(factoryContext, {
      token: owner.token,
      name: 'Dashboard Organization'
    })

    writeAuthToken(owner.token)

    renderWithProviders(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(`Signed in as ${owner.user.email}`)).toBeInTheDocument()
    })

    const organizationHeading = await screen.findByRole('heading', { name: 'Current organization' })
    const organizationCard = organizationHeading.closest('section')
    expect(organizationCard).toBeTruthy()
    if (!organizationCard) {
      throw new Error('Expected current organization section to exist')
    }

    expect(
      within(organizationCard).getByText('Dashboard Organization', { selector: 'strong' })
    ).toBeInTheDocument()
  })

  it('redirects to sign-in and clears session when auth token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<DashboardPage />)

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location).toEqual({
        pathname: '/sign-in',
        search: '?next=%2Fdashboard'
      })
      expect(`${location.pathname}${location.search}`).toBe(dashboardSignInRedirect)
    })

    expect(readAuthToken()).toBeNull()
  })
})
