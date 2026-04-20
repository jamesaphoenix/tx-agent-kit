// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from './AppSidebar'
import { SidebarProvider } from './ui/sidebar'

const routerPushMock = vi.hoisted(() => vi.fn())
const routerReplaceMock = vi.hoisted(() => vi.fn())
const pathnameMock = vi.hoisted(() => vi.fn(() => '/org/org_1/team_1'))

const organizationsMocks = vi.hoisted(() => {
  const inProgressOnboardingData = {
    version: 1,
    status: 'in_progress',
    currentStep: 'spend_cap',
    completedSteps: ['organization_profile', 'workspace_setup', 'goals'],
    completedAt: null
  } as const

  const completedOnboardingData = {
    version: 1,
    status: 'completed',
    currentStep: 'completed',
    completedSteps: ['organization_profile', 'workspace_setup', 'goals', 'spend_cap', 'completed'],
    completedAt: '2026-04-16T08:00:00.000Z'
  } as const

  const organization = {
    id: 'org_1',
    name: 'Stale Cache Org',
    billingEmail: null,
    onboardingData: inProgressOnboardingData,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePaymentMethodId: null,
    stripeMeteredSubscriptionItemId: null,
    creditsBalance: 2_000_000,
    reservedCredits: 0,
    autoRechargeEnabled: false,
    autoRechargeThreshold: null,
    autoRechargeAmount: null,
    isSubscribed: true,
    subscriptionStatus: 'active',
    subscriptionPlan: 'pro',
    subscriptionStartedAt: null,
    subscriptionEndsAt: null,
    subscriptionCurrentPeriodEnd: null,
    createdAt: '2026-04-16T08:00:00.000Z',
    updatedAt: '2026-04-16T08:00:00.000Z'
  } as const

  return {
    staleListOrganization: organization,
    completedCurrentOrganization: {
      ...organization,
      onboardingData: completedOnboardingData,
      updatedAt: '2026-04-16T08:01:00.000Z'
    },
    listOrganizations: vi.fn(),
    getOrganization: vi.fn()
  }
})

const teamsMocks = vi.hoisted(() => ({
  listTeams: vi.fn()
}))

vi.mock('next/navigation', () => ({
  usePathname: pathnameMock,
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock
  })
}))

vi.mock('../hooks/use-permissions', () => ({
  useMyPermissions: () => ({
    data: { permissions: [] }
  })
}))

vi.mock('../lib/api/generated/organizations/organizations', () => ({
  useOrganizationsListOrganizations: organizationsMocks.listOrganizations,
  useOrganizationsGetOrganization: organizationsMocks.getOrganization
}))

vi.mock('../lib/api/generated/teams/teams', () => ({
  useTeamsListTeams: teamsMocks.listTeams,
  teamsCreateTeam: vi.fn()
}))

const renderSidebar = (): void => {
  render(
    <SidebarProvider>
      <AppSidebar orgId="org_1" teamId="team_1" principalEmail="owner@example.com" />
    </SidebarProvider>
  )
}

describe('AppSidebar', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    routerPushMock.mockClear()
    routerReplaceMock.mockClear()
    pathnameMock.mockReturnValue('/org/org_1/team_1')
    organizationsMocks.listOrganizations.mockReturnValue({
      data: {
        data: [organizationsMocks.staleListOrganization],
        total: 1,
        nextCursor: null,
        prevCursor: null
      },
      isLoading: false
    })
    organizationsMocks.getOrganization.mockReturnValue({
      data: organizationsMocks.completedCurrentOrganization,
      isLoading: false,
      isFetching: false
    })
    teamsMocks.listTeams.mockReturnValue({
      data: {
        data: [{
          id: 'team_1',
          organizationId: 'org_1',
          name: 'Sandbox',
          website: null,
          brandSettings: null,
          createdAt: '2026-04-16T08:00:00.000Z',
          updatedAt: '2026-04-16T08:00:00.000Z'
        }]
      },
      isLoading: false,
      refetch: vi.fn()
    })
  })

  it('hides the setup CTA when the current organization query has completed onboarding even if the list cache is stale', () => {
    renderSidebar()

    expect(screen.queryByRole('link', { name: /continue setup/i })).toBeNull()
  })

  it('redirects to the first visible workspace when the current workspace is no longer accessible', async () => {
    teamsMocks.listTeams.mockReturnValue({
      data: {
        data: [{
          id: 'team_2',
          organizationId: 'org_1',
          name: 'Fallback Workspace',
          website: null,
          brandSettings: null,
          createdAt: '2026-04-16T08:00:00.000Z',
          updatedAt: '2026-04-16T08:00:00.000Z'
        }]
      },
      isLoading: false,
      refetch: vi.fn()
    })

    renderSidebar()

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/org/org_1/team_2')
    })
  })

  it('animates the desktop settings section open and closed without unmounting it', async () => {
    const user = userEvent.setup()
    renderSidebar()

    const settingsButton = screen.getByRole('button', { name: 'Settings' })
    const settingsSection = screen.getByTestId('app-sidebar-settings-section')

    expect(settingsSection.getAttribute('aria-hidden')).toBe('true')
    expect(settingsSection.className).toContain('grid-rows-[0fr]')
    expect(settingsSection.className).toContain('transition-[grid-template-rows,opacity]')

    await user.click(settingsButton)

    expect(settingsButton.getAttribute('aria-expanded')).toBe('true')
    expect(settingsSection.getAttribute('aria-hidden')).toBe('false')
    expect(settingsSection.className).toContain('grid-rows-[1fr]')

    await user.click(settingsButton)

    expect(settingsButton.getAttribute('aria-expanded')).toBe('false')
    expect(settingsSection.getAttribute('aria-hidden')).toBe('true')
    expect(settingsSection.className).toContain('grid-rows-[0fr]')
  })
})
