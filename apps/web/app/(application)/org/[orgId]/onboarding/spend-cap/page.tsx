'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useCurrentPrincipal } from '@/hooks/use-session-store'
import { useBillingGetBillingSettings } from '@/lib/api/generated/billing/billing'
import {
  getOrganizationsGetOrganizationQueryKey,
  getOrganizationsListOrganizationsQueryKey,
  organizationsUpdateOrganization
} from '@/lib/api/generated/organizations/organizations'
import { teamsListTeams } from '@/lib/api/generated/teams/teams'
import { syncOrganizationCache } from '@/lib/organization-cache'
import { DashboardShell } from '@/components/DashboardShell'
import { SpendCapStep } from '@/components/onboarding/SpendCapStep'

export default function SpendCapOnboardingPage(): React.ReactElement {
  const params = useParams<{ orgId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const principal = useCurrentPrincipal()
  const orgId = params.orgId
  const billingQuery = useBillingGetBillingSettings(orgId, {
    query: {}
  })

  return (
    <DashboardShell
      title="Spend cap"
      subtitle="Set an optional monthly guardrail before you launch more paid AI work."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      {billingQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl">
          <SpendCapStep
            organizationId={orgId}
            initialUsageCapDecimillicents={billingQuery.data?.usageCapDecimillicents ?? null}
            onContinue={async () => {
              const updatedOrganization = await organizationsUpdateOrganization(orgId, {
                onboardingData: {
                  version: 1,
                  status: 'completed',
                  currentStep: 'completed',
                  completedSteps: ['organization_profile', 'workspace_setup', 'goals', 'spend_cap', 'completed'],
                  completedAt: new Date().toISOString()
                }
              })
              syncOrganizationCache(queryClient, updatedOrganization)

              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: getOrganizationsListOrganizationsQueryKey()
                }),
                queryClient.invalidateQueries({
                  queryKey: getOrganizationsGetOrganizationQueryKey(orgId)
                })
              ])

              const teams = await teamsListTeams({ organizationId: orgId, limit: '100', sortBy: 'name', sortOrder: 'asc' })
              const firstTeam = teams.data[0]

              router.replace(firstTeam ? `/org/${orgId}/${firstTeam.id}` : `/org/${orgId}/workspaces`)
            }}
            onBack={() => {
              router.replace(`/org/${orgId}/onboarding/welcome`)
            }}
          />
        </div>
      )}
    </DashboardShell>
  )
}
