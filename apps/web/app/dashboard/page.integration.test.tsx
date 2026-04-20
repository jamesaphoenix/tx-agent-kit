import React from 'react'
import { randomUUID } from 'node:crypto'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import DashboardPage from './page'
import { renderWithProviders, screen, waitFor, within } from '../../integration/test-utils'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'

describe('DashboardPage integration', () => {
  it('shows default state when no auth token is present', async () => {
    renderWithProviders(<DashboardPage />)

    // Without a token the session bootstrap resolves with no principal.
    // The page renders with isSessionReady=true but principal=null,
    // so the query fires unauthenticated and the page shows its default state.
    await waitFor(() => {
      expect(screen.getByText('Loading profile...')).toBeInTheDocument()
    })
  })

  it('loads current user and organization when authenticated', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `dashboard-owner-${randomUUID()}@example.com`,
      password: 'dashboard-owner-pass-12345',
      name: 'Dashboard Owner'
    })

    await createOrganization(factoryContext, {
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

    await waitFor(() => {
      expect(
        within(organizationCard).getByText('Dashboard Organization', { selector: 'strong' })
      ).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('clears auth token when token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<DashboardPage />)

    // AuthBootstrapProvider calls restoreCurrentPrincipal which clears the token
    // on auth error, then calls sessionStoreActions.clear().
    // The page shows its default state (no redirect).
    await waitFor(() => {
      expect(readAuthToken()).toBeNull()
    })
  })
})
