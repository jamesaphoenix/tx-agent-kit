'use client'

import type { Organization, Team } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../hooks/use-session-store'
import { clientApi } from '../../../../../lib/client-api'
import { handleUnauthorizedApiError } from '../../../../../lib/client-auth'

interface DashboardState {
  organization: Organization | null
  team: Team | null
}

const emptyState: DashboardState = {
  organization: null,
  team: null
}

export default function TeamDashboardPage() {
  const router = useRouter()
  const params = useParams<{ orgId: string; teamId: string }>()
  const { orgId, teamId } = params
  const principal = useCurrentPrincipal()
  const [state, setState] = useState<DashboardState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [organization, team] = await Promise.all([clientApi.getOrganization(orgId), clientApi.getTeam(teamId)])
      setState({ organization, team })
    } catch (error_) {
      if (handleUnauthorizedApiError(error_, router, `/org/${orgId}/${teamId}`)) {
        return
      }
      setError(error_ instanceof Error ? error_.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [orgId, teamId, router])

  useEffect(() => {
    void load()
  }, [load])

  const metrics = [
    {
      label: 'Workspace',
      value: state.team?.name ?? (loading ? 'Loading' : 'Unknown')
    },
    {
      label: 'Organization',
      value: state.organization?.name ?? (loading ? 'Loading' : 'Unknown')
    },
    {
      label: 'State',
      value: loading ? 'Refreshing' : 'Current',
      tone: loading ? 'warning' as const : 'success' as const
    }
  ]

  return (
    <DashboardShell
      title={state.team?.name ?? 'Workspace dashboard'}
      subtitle={principal ? `Signed in as ${principal.email}` : 'Loading profile...'}
      principalEmail={principal?.email}
      orgId={orgId}
      teamId={teamId}
      metrics={metrics}
    >
      {error && <p className="error">{error}</p>}

      <div className="dashboard-shell-grid">
        <section className="card stack">
          <h2>Organization</h2>
          {state.organization && (
            <>
              <p><strong>{state.organization.name}</strong></p>
              <p className="muted">Status: {state.organization.subscriptionStatus}</p>
            </>
          )}
          {!state.organization && loading && (
            <p className="muted">Loading organization...</p>
          )}
        </section>

        <section className="card stack">
          <h2>Team</h2>
          {state.team && (
            <>
              <p><strong>{state.team.name}</strong></p>
              {state.team.website && <p className="muted">{state.team.website}</p>}
            </>
          )}
          {!state.team && loading && (
            <p className="muted">Loading team...</p>
          )}
        </section>
      </div>
    </DashboardShell>
  )
}
