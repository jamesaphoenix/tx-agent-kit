import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createOrganization, createUser, defaultTestBrandSettings } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import SpendCapOnboardingPage from '@/app/(application)/org/[orgId]/onboarding/spend-cap/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderSpendCapOnboardingPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <SpendCapOnboardingPage />
    </PathParamsContext.Provider>
  )
}

describe('SpendCapOnboardingPage integration', () => {
  it('persists the selected cap, completes onboarding, and returns to the first workspace', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-spend-cap-onboarding-${randomUUID()}@example.com`,
      password: 'billing-spend-cap-onboarding-pass-12345',
      name: 'Billing Spend Cap Onboarding Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Spend Cap Onboarding Org'
    })

    writeAuthToken(owner.token)

    const team = await clientApi.createTeam({
      organizationId: organization.id,
      name: 'Spend Cap Workspace',
      brandSettings: defaultTestBrandSettings
    })

    resetIntegrationRouterLocation(`/org/${organization.id}/onboarding/spend-cap`)

    const user = userEvent.setup()
    renderSpendCapOnboardingPage(organization.id)

    await screen.findByRole('link', { name: /continue setup/i })
    await user.click(await screen.findByRole('button', { name: '$250' }))
    await user.click(screen.getByRole('button', { name: /set cap and continue/i }))

    await waitFor(async () => {
      const billing = await clientApi.getBillingSettings(organization.id)
      expect(billing.usageCapDecimillicents).toBe(2_500_000_000)

      const updatedOrganization = await clientApi.getOrganization(organization.id)
      expect(updatedOrganization.onboardingData?.status).toBe('completed')
      expect(updatedOrganization.onboardingData?.completedSteps).toContain('completed')
    })

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/${team.id}`)
    })
    expect(screen.queryByRole('link', { name: /continue setup/i })).not.toBeInTheDocument()
  })
})
