import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import WelcomeOnboardingPage from '@/app/(application)/org/[orgId]/onboarding/welcome/page'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

function renderWelcomeOnboardingPage(orgId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId }}>
      <WelcomeOnboardingPage />
    </PathParamsContext.Provider>
  )
}

describe('WelcomeOnboardingPage integration', () => {
  it('surfaces the welcome-credit step and advances into spend-cap onboarding', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-welcome-${randomUUID()}@example.com`,
      password: 'billing-welcome-pass-12345',
      name: 'Billing Welcome Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Welcome Org'
    })

    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${organization.id}/onboarding/welcome`)

    const user = userEvent.setup()
    renderWelcomeOnboardingPage(organization.id)

    expect(await screen.findByRole('heading', { name: /welcome/i })).toBeInTheDocument()
    expect(screen.getByText(/\$20 welcome credit/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /set spend cap/i }))

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${organization.id}/onboarding/spend-cap`)
    })
  })
})
