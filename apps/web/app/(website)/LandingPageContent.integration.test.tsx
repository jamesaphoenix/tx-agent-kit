import { clearAuthToken, readAuthToken } from '@/lib/auth-token'
import { authMe } from '@/lib/api/generated/auth/auth'
import {
  billingGetBillingSettings,
  billingGetCreditBalance
} from '@/lib/api/generated/billing/billing'
import { organizationsListOrganizations } from '@/lib/api/generated/organizations/organizations'
import { teamsListTeams } from '@/lib/api/generated/teams/teams'
import { resetIntegrationRouterLocation, readIntegrationRouterLocation } from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import { sessionStoreActions } from '@/stores/session-store'
import { beforeEach, describe, expect, it } from 'vitest'
import { LandingPageContent } from './LandingPageContent'

describe('LandingPageContent dev utils integration', () => {
  beforeEach(() => {
    clearAuthToken()
    sessionStoreActions.clear()
    resetIntegrationRouterLocation('/')
  })

  it('shows the custom dev utils launcher in development', () => {
    renderWithProviders(<LandingPageContent />)

    expect(screen.getByRole('button', { name: 'Open developer utilities' })).toBeInTheDocument()
  })

  it('creates a fresh local Pro workspace with credits from the homepage launcher', async () => {
    const user = userEvent.setup()

    renderWithProviders(<LandingPageContent />)

    await user.click(screen.getByRole('button', { name: 'Open developer utilities' }))
    await user.click(screen.getByRole('button', { name: 'Fresh Pro + $20 local credit' }))

    let dashboardPathname = ''

    await waitFor(() => {
      expect(readAuthToken()).not.toBeNull()
      expect(readIntegrationRouterLocation().pathname).not.toBe('/')
    }, { timeout: 10_000 })

    await waitFor(async () => {
      const organizations = await organizationsListOrganizations()

      const organization = organizations.data.find((candidate) => candidate.name.startsWith('Dev Org '))
      if (!organization) {
        throw new Error('Expected seeded organization to exist')
      }
      const teams = await teamsListTeams({ organizationId: organization.id })

      expect(teams.data).toHaveLength(1)

      dashboardPathname = `/org/${organization.id}/${teams.data[0]?.id ?? ''}`

      expect(readIntegrationRouterLocation().pathname).toBe(dashboardPathname)

      const billing = await billingGetBillingSettings(organization.id)
      const balance = await billingGetCreditBalance(organization.id)
      expect(billing.isSubscribed).toBe(true)
      expect(billing.subscriptionPlan).toBe('pro')
      expect(balance.availableDecimillicents).toBeGreaterThan(0)
    })

    const principal = await authMe()

    expect(principal.email).toMatch(/^dev-utils\+.+@example\.com$/)
    expect(dashboardPathname).not.toHaveLength(0)
  })

  it('creates a fresh free workspace without billing activation', async () => {
    const user = userEvent.setup()

    renderWithProviders(<LandingPageContent />)

    await user.click(screen.getByRole('button', { name: 'Open developer utilities' }))
    await user.click(screen.getByRole('button', { name: 'Fresh free org' }))

    await waitFor(() => {
      expect(readAuthToken()).not.toBeNull()
      expect(readIntegrationRouterLocation().pathname).not.toBe('/')
    }, { timeout: 10_000 })

    await waitFor(async () => {
      const organizations = await organizationsListOrganizations()

      const organization = organizations.data.find((candidate) => candidate.name.startsWith('Dev Org '))
      if (!organization) {
        throw new Error('Expected seeded organization to exist')
      }
      const billing = await billingGetBillingSettings(organization.id)
      const balance = await billingGetCreditBalance(organization.id)

      expect(billing.isSubscribed).toBe(false)
      expect(billing.subscriptionPlan).toBeNull()
      expect(balance.availableDecimillicents).toBe(0)
    })
  })
})
