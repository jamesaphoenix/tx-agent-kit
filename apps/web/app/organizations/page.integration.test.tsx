import React from 'react'
import { readAuthToken, writeAuthToken } from '@/lib/auth-token'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import OrganizationsPage from './page'
import { createWebFactoryContext } from '../../integration/support/web-integration-context'
import { readIntegrationRouterLocation } from '../../integration/support/next-router-context'
import { renderWithProviders, screen, waitFor, within } from '../../integration/test-utils'

const organizationsSignInRedirect = '/sign-in?next=%2Forganizations'

describe('OrganizationsPage integration', () => {
  it('redirects to sign-in when no auth token is present', async () => {
    renderWithProviders(<OrganizationsPage />)

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location).toEqual({
        pathname: '/sign-in',
        search: '?next=%2Forganizations'
      })
      expect(`${location.pathname}${location.search}`).toBe(organizationsSignInRedirect)
    })
  })

  it('loads authenticated organization data', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'organizations-owner@example.com',
      password: 'organizations-owner-pass-12345',
      name: 'Organizations Owner'
    })

    const organization = await createTeam(factoryContext, {
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
    }, { timeout: 5_000 })
    expect(readIntegrationRouterLocation().pathname).not.toBe('/sign-in')
  })

  it('redirects to sign-in and clears session when auth token is invalid', async () => {
    writeAuthToken('invalid-token')

    renderWithProviders(<OrganizationsPage />)

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location).toEqual({
        pathname: '/sign-in',
        search: '?next=%2Forganizations'
      })
      expect(`${location.pathname}${location.search}`).toBe(organizationsSignInRedirect)
    })

    expect(readAuthToken()).toBeNull()
  })
})
