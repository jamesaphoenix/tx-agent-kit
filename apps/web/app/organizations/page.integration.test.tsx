import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import OrganizationsPage from './page'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'
import { renderWithProviders, screen, waitFor, within } from '../../integration/test-utils'

describe('OrganizationsPage integration', () => {
  it('shows default state when no auth token is present', async () => {
    renderWithProviders(<OrganizationsPage />)

    // Without a token the session bootstrap resolves with no principal.
    // The page uses enabled: isSessionReady so it fires the query unauthenticated
    // and shows its default empty/loading state without redirecting.
    await waitFor(() => {
      expect(screen.getByText('Your organizations')).toBeInTheDocument()
    })
  })

  it('loads authenticated organization data', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Organizations Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Organizations Integration Team'
    })

    writeAuthToken(owner.token)

    renderWithProviders(<OrganizationsPage />)

    await waitFor(() => {
      expect(screen.getByText('Your organizations')).toBeInTheDocument()
    })

    const organizationsHeading = await screen.findByRole('heading', { name: 'Your organizations' })
    const organizationsSection = organizationsHeading.closest('section')
    expect(organizationsSection).toBeTruthy()
    if (!organizationsSection) {
      throw new Error('Expected organizations section to be rendered')
    }

    await waitFor(() => {
      expect(
        within(organizationsSection).getByText(organization.name, { selector: 'strong' })
      ).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('clears auth token when token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<OrganizationsPage />)

    // AuthBootstrapProvider calls restoreCurrentPrincipal which clears the token
    // on auth error, then calls sessionStoreActions.clear().
    await waitFor(() => {
      expect(readAuthToken()).toBeNull()
    })
  })
})
