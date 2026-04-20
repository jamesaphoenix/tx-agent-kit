'use client'

import { useParams } from 'next/navigation'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../hooks/use-session-store'
import { useOrganizationsGetOrganization } from '../../../../../lib/api/generated/organizations/organizations'
import { useTeamsGetTeam } from '../../../../../lib/api/generated/teams/teams'

export default function TeamDashboardPage() {
  const params = useParams<{ orgId: string; teamId: string }>()
  const { orgId, teamId } = params
  const principal = useCurrentPrincipal()

  const orgQuery = useOrganizationsGetOrganization(orgId, {
    query: {}
  })
  const teamQuery = useTeamsGetTeam(teamId, {
    query: {}
  })

  const organization = orgQuery.data ?? null
  const team = teamQuery.data ?? null
  const loading = orgQuery.isLoading || teamQuery.isLoading
  const error = orgQuery.error || teamQuery.error ? 'Failed to load dashboard' : null

  return (
    <DashboardShell
      title={team?.name ?? 'Dashboard'}
      subtitle={principal ? `Signed in as ${principal.email}` : 'Loading profile...'}
      principalEmail={principal?.email}
      orgId={orgId}
      teamId={teamId}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {!loading && !error && !organization && !team && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No dashboard data available.</p>
        </div>
      )}

      {!loading && (error || organization || team) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-sm font-medium text-muted-foreground mb-3">Organization</h2>
            {organization ? (
              <>
                <p className="text-base font-semibold">{organization.name}</p>
                <p className="text-sm text-muted-foreground mt-1">Status: {organization.subscriptionStatus}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No organization data.</p>
            )}
          </div>

          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-sm font-medium text-muted-foreground mb-3">Workspace</h2>
            {team ? (
              <>
                <p className="text-base font-semibold">{team.name}</p>
                {team.website && <p className="text-sm text-muted-foreground mt-1">{team.website}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No workspace data.</p>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  )
}
