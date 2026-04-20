import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { getOrganizationsGetOrganizationQueryKey } from './api/generated/organizations/organizations'
import type { OrganizationsUpdateOrganization200OnboardingData } from './api/generated/schemas/organizationsUpdateOrganization200OnboardingData'
import { syncOrganizationCache } from './organization-cache'

const inProgressOnboardingData: NonNullable<OrganizationsUpdateOrganization200OnboardingData> = {
  version: 1,
  status: 'in_progress',
  currentStep: 'spend_cap',
  completedSteps: ['organization_profile', 'workspace_setup', 'goals'],
  completedAt: null
}

const completedOnboardingData: NonNullable<OrganizationsUpdateOrganization200OnboardingData> = {
  version: 1,
  status: 'completed',
  currentStep: 'completed',
  completedSteps: ['organization_profile', 'workspace_setup', 'goals', 'spend_cap', 'completed'],
  completedAt: '2026-04-16T08:01:00.000Z'
}

const organization = {
  id: 'org_1',
  name: 'Cached Org',
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

describe('syncOrganizationCache', () => {
  it('updates organization detail and list caches with completed onboarding data', () => {
    const queryClient = new QueryClient()
    const listQueryKey = [
      '/v1/organizations',
      { limit: '100', sortBy: 'name', sortOrder: 'asc' }
    ] as const
    const detailQueryKey = getOrganizationsGetOrganizationQueryKey(organization.id)
    const completedOrganization = {
      ...organization,
      onboardingData: completedOnboardingData,
      updatedAt: '2026-04-16T08:01:00.000Z'
    }

    queryClient.setQueryData(detailQueryKey, organization)
    queryClient.setQueryData(listQueryKey, {
      data: [organization],
      total: 1,
      nextCursor: null,
      prevCursor: null
    })

    syncOrganizationCache(queryClient, completedOrganization)

    const detailCache = queryClient.getQueryData<typeof completedOrganization>(detailQueryKey)
    const listCache = queryClient.getQueryData<{
      data: Array<typeof completedOrganization>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(listQueryKey)

    expect(detailCache?.onboardingData?.status).toBe('completed')
    expect(listCache?.data[0]?.onboardingData?.status).toBe('completed')
  })
})
