import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import OnboardingPage from './page'
import { readIntegrationRouterLocation } from '@/integration/support/next-router-context'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'

describe('OrganizationOnboardingPage integration', () => {
  it('walks through the onboarding steps, saves a spend cap, and persists onboarding JSON on organization', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Onboarding Owner'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderWithProviders(<OnboardingPage />)

    await user.type(
      await screen.findByLabelText('Organization name'),
      'tx-agent-kit Labs'
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.type(
      await screen.findByLabelText('Workspace name'),
      'Launch Operations'
    )
    await user.type(
      await screen.findByLabelText('Workspace website'),
      'https://octospark.example'
    )

    // BrandSettingsFields requires industry, target audience, and brand guidelines
    // before workspace_setup will advance to the goals step.
    const industryInput = await screen.findByLabelText('Industry')
    await user.type(industryInput, 'Software{enter}')
    await user.type(
      await screen.findByLabelText('Target audience'),
      'B2B operators automating workflows'
    )
    await user.type(
      await screen.findByLabelText('Brand guidelines'),
      'Professional, concise, and action oriented.'
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.selectOptions(await screen.findByLabelText('Primary goal'), 'automation')
    await user.selectOptions(screen.getByLabelText('Team size'), '6-20')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByRole('heading', { name: 'Set a monthly spend cap (optional)' })
    await user.click(screen.getByRole('button', { name: '$250' }))
    await user.click(screen.getByRole('button', { name: 'Set cap and continue' }))

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location.pathname.startsWith('/org/')).toBe(true)
      expect(location.pathname).not.toBe('/org/onboarding')
    })

    const organizations = await clientApi.listOrganizations()
    const organization = organizations.data[0]
    expect(organization).toBeTruthy()
    expect(organization?.name).toBe('tx-agent-kit Labs')
    expect(organization?.onboardingData?.status).toBe('completed')
    expect(organization?.onboardingData?.completedSteps).toContain('completed')
    expect(organization?.onboardingData?.completedSteps).toContain('spend_cap')

    if (!organization) {
      throw new Error('Expected organization to be created during onboarding')
    }

    const teams = await clientApi.listTeams(organization.id)
    expect(teams.data.some((team) => team.name === 'Launch Operations')).toBe(true)

    const billing = await clientApi.getBillingSettings(organization.id)
    expect(billing.usageCapDecimillicents).toBe(2_500_000_000)
  })

  it('requires a valid workspace website before continuing', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Onboarding Owner Invalid Website'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderWithProviders(<OnboardingPage />)

    await user.type(
      await screen.findByLabelText('Organization name'),
      'tx-agent-kit Labs'
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.type(
      await screen.findByLabelText('Workspace name'),
      'Launch Operations'
    )
    const websiteInput = await screen.findByLabelText('Workspace website')
    await user.type(websiteInput, 'hasda')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(websiteInput).toBeInvalid()
    expect(screen.queryByLabelText('Primary goal')).not.toBeInTheDocument()
  })
})
