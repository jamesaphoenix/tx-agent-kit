'use client'

import type { AuthPrincipal, Organization, Team } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { clientApi } from '../../../../../lib/client-api'
import { handleUnauthorizedApiError } from '../../../../../lib/client-auth'

interface DashboardState {
  principal: AuthPrincipal | null
  organization: Organization | null
  team: Team | null
}

const emptyState: DashboardState = {
  principal: null,
  organization: null,
  team: null
}

export default function TeamDashboardPage() {
  const router = useRouter()
  const params = useParams<{ orgId: string; teamId: string }>()
  const { orgId, teamId } = params
  const [state, setState] = useState<DashboardState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [principal, organization, team] = await Promise.all([
        clientApi.me(),
        clientApi.getOrganization(orgId),
        clientApi.getTeam(teamId)
      ])
      setState({ principal, organization, team })
    } catch (err) {
      if (handleUnauthorizedApiError(err, router, `/org/${orgId}/${teamId}`)) {
        return
      }
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
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
      subtitle={state.principal ? `Signed in as ${state.principal.email}` : 'Loading profile...'}
      principalEmail={state.principal?.email}
      orgId={orgId}
      teamId={teamId}
      metrics={metrics}
    >
      {error && <p className="error">{error}</p>}

      <div className="dashboard-shell-grid">
        <section className="card stack">
          <h2>Organization</h2>
          {state.organization ? (
            <>
              <p><strong>{state.organization.name}</strong></p>
              <p className="muted">Status: {state.organization.subscriptionStatus}</p>
            </>
          ) : loading ? (
            <p className="muted">Loading organization...</p>
          ) : null}
        </section>

        <section className="card stack">
          <h2>Team</h2>
          {state.team ? (
            <>
              <p><strong>{state.team.name}</strong></p>
              {state.team.website && <p className="muted">{state.team.website}</p>}
            </>
          ) : loading ? (
            <p className="muted">Loading team...</p>
          ) : null}
        </section>
      </div>
    </DashboardShell>
  )
}
