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
  it('walks through the onboarding steps and persists onboarding JSON on organization', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'onboarding-owner@example.com',
      password: 'onboarding-owner-pass-12345',
      name: 'Onboarding Owner'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderWithProviders(<OnboardingPage />)

    await user.type(
      await screen.findByLabelText('Organization name'),
      'OctoSpark Labs'
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.selectOptions(await screen.findByLabelText('Primary goal'), 'automation')
    await user.selectOptions(screen.getByLabelText('Team size'), '6-20')
    await user.click(screen.getByRole('button', { name: 'Finish onboarding' }))

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location.pathname.startsWith('/org/')).toBe(true)
      expect(location.pathname).not.toBe('/org/onboarding')
    })

    const organizations = await clientApi.listOrganizations()
    const organization = organizations.data[0]
    expect(organization).toBeTruthy()
    expect(organization?.name).toBe('OctoSpark Labs')
    expect(organization?.onboardingData?.status).toBe('completed')
    expect(organization?.onboardingData?.completedSteps).toContain('completed')

    if (!organization) {
      throw new Error('Expected organization to be created during onboarding')
    }

    const teams = await clientApi.listTeams(organization.id)
    expect(teams.data.some((team) => team.name === 'Launch Operations')).toBe(true)
  })

  it('requires a valid workspace website before continuing', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: 'onboarding-owner-invalid-website@example.com',
      password: 'onboarding-owner-pass-12345',
      name: 'Onboarding Owner Invalid Website'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    renderWithProviders(<OnboardingPage />)

    await user.type(
      await screen.findByLabelText('Organization name'),
      'OctoSpark Labs'
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
