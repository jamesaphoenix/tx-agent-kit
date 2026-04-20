import React from 'react'
import { clearAuthToken, readAuthToken } from '@/lib/auth-token'
import {
  billingGetBillingSettings,
  billingGetCreditBalance
} from '@/lib/api/generated/billing/billing'
import { organizationsListOrganizations } from '@/lib/api/generated/organizations/organizations'
import { teamsListTeams } from '@/lib/api/generated/teams/teams'
import { resetWebEnvCache } from '@/lib/env'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import { sessionStore, sessionStoreActions } from '@/stores/session-store'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LandingPage from './page'

const readSeededRoute = (): { organizationId: string; teamId: string } => {
  const pathname = readIntegrationRouterLocation().pathname
  const match = /^\/org\/([^/]+)\/([^/]+)$/.exec(pathname)
  if (!match?.[1] || !match[2]) {
    throw new Error(`Expected seeded org/team route, received ${pathname}`)
  }
  return {
    organizationId: match[1],
    teamId: match[2]
  }
}

beforeEach(() => {
  clearAuthToken()
  sessionStoreActions.clear()
  resetIntegrationRouterLocation('/')
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  resetWebEnvCache()
})

describe('LandingPage integration', () => {
  it('shows the dev utilities launcher on the homepage in test mode', () => {
    resetIntegrationRouterLocation('/')

    renderWithProviders(<LandingPage />)

    expect(
      screen.getByRole('button', { name: /open developer utilities/i })
    ).toBeInTheDocument()
  })

  it('seeds a fresh free org and routes into the created workspace', async () => {
    resetIntegrationRouterLocation('/')

    const user = userEvent.setup()
    renderWithProviders(<LandingPage />)

    await user.click(screen.getByRole('button', { name: /open developer utilities/i }))
    await user.click(screen.getByRole('button', { name: /fresh free org/i }))

    await waitFor(() => {
      expect(readAuthToken()).not.toBeNull()
      expect(readIntegrationRouterLocation().pathname).not.toBe('/')
    }, { timeout: 10_000 })

    await waitFor(async () => {
      const { organizationId, teamId } = readSeededRoute()
      const organizations = await organizationsListOrganizations()
      const organization = organizations.data.find((item) => item.id === organizationId)
      if (!organization) {
        throw new Error('Expected the routed seeded organization')
      }

      const teams = await teamsListTeams({ organizationId: organization.id })
      const team = teams.data.find((item) => item.id === teamId)
      if (!team) {
        throw new Error('Expected the routed seeded workspace')
      }

      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/${team.id}`)
    })
  })

  it('seeds a subscribed local Pro account with welcome credits from the homepage', async () => {
    resetIntegrationRouterLocation('/')

    const user = userEvent.setup()
    renderWithProviders(<LandingPage />)

    await user.click(screen.getByRole('button', { name: /open developer utilities/i }))
    await user.click(screen.getByRole('button', { name: /fresh pro \+ \$20 local credit/i }))

    await waitFor(() => {
      expect(readAuthToken()).not.toBeNull()
      expect(readIntegrationRouterLocation().pathname).not.toBe('/')
    }, { timeout: 10_000 })

    await waitFor(async () => {
      const { organizationId, teamId } = readSeededRoute()
      const organizations = await organizationsListOrganizations()
      const organization = organizations.data.find((item) => item.id === organizationId)
      if (!organization) {
        throw new Error('Expected the routed seeded organization')
      }

      const teams = await teamsListTeams({ organizationId: organization.id })
      const team = teams.data.find((item) => item.id === teamId)
      if (!team) {
        throw new Error('Expected the routed seeded workspace')
      }

      const billing = await billingGetBillingSettings(organization.id)
      const balance = await billingGetCreditBalance(organization.id)

      expect(organization.onboardingData?.status).toBe('completed')
      expect(billing.isSubscribed).toBe(true)
      expect(billing.subscriptionStatus).toBe('active')
      expect(billing.subscriptionPlan).toBe('pro')
      expect(balance.availableDecimillicents).toBe(200_000_000)
      expect(sessionStore.state.principal?.roles).toContain('admin')
      expect(sessionStore.state.principal?.permissions).toContain('manage_billing')
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/${team.id}`)
    })
  })

  it('shows the Stripe checkout preset when a Stripe publishable key is configured', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_homepage_dev_utils'
    resetWebEnvCache()
    resetIntegrationRouterLocation('/')

    const user = userEvent.setup()
    renderWithProviders(<LandingPage />)

    await user.click(screen.getByRole('button', { name: /open developer utilities/i }))

    expect(
      screen.getByRole('button', { name: /fresh pro \+ stripe checkout/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /fresh pro \+ local credit \+ stripe checkout/i })
    ).toBeInTheDocument()
  })

  it('can seed local credits first and then hand off to Stripe checkout from the homepage', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_homepage_dev_utils'
    resetWebEnvCache()
    resetIntegrationRouterLocation('/')

    const user = userEvent.setup()
    renderWithProviders(<LandingPage />)

    await user.click(screen.getByRole('button', { name: /open developer utilities/i }))
    await user.click(
      screen.getByRole('button', { name: /fresh pro \+ local credit \+ stripe checkout/i })
    )

    await waitFor(() => {
      expect(readAuthToken()).not.toBeNull()
      expect(readIntegrationRouterLocation().pathname).not.toBe('/')
    }, { timeout: 10_000 })

    await waitFor(async () => {
      const { organizationId, teamId } = readSeededRoute()
      const organizations = await organizationsListOrganizations()
      const organization = organizations.data.find((item) => item.id === organizationId)
      if (!organization) {
        throw new Error('Expected the routed seeded organization')
      }

      const teams = await teamsListTeams({ organizationId: organization.id })
      const team = teams.data.find((item) => item.id === teamId)
      if (!team) {
        throw new Error('Expected the routed seeded workspace')
      }

      const billing = await billingGetBillingSettings(organization.id)
      const balance = await billingGetCreditBalance(organization.id)

      expect(billing.isSubscribed).toBe(true)
      expect(billing.subscriptionStatus).toBe('active')
      expect(billing.subscriptionPlan).toBe('pro')
      expect(balance.availableDecimillicents).toBe(200_000_000)
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/${team.id}`)
    })
  })
})
