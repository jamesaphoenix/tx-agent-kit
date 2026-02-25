'use client'

import type { AuthPrincipal, Organization } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardShell } from '../../components/DashboardShell'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

interface DashboardState {
  principal: AuthPrincipal | null
  organizations: Organization[]
}

const emptyState: DashboardState = {
  principal: null,
  organizations: []
}

export default function DashboardPage() {
  const router = useRouter()
  const [state, setState] = useState<DashboardState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!ensureSessionOrRedirect(router, '/dashboard')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const principal = await clientApi.me()
      const organizationPayload = await clientApi.listOrganizations()

      setState({
        principal,
        organizations: organizationPayload.data
      })
    } catch (err) {
      if (handleUnauthorizedApiError(err, router, '/dashboard')) {
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const firstOrganization = state.organizations[0]

  const metrics = [
    {
      label: 'Organizations',
      value: String(state.organizations.length)
    },
    {
      label: 'Session',
      value: state.principal ? 'Authenticated' : 'Checking',
      tone: state.principal ? 'success' as const : 'warning' as const
    },
    {
      label: 'Sync',
      value: loading ? 'Live refresh' : 'Up to date',
      tone: loading ? 'warning' as const : 'success' as const
    }
  ]

  return (
    <DashboardShell
      title="Operations Dashboard"
      subtitle={state.principal ? `Signed in as ${state.principal.email}` : 'Loading profile...'}
      principalEmail={state.principal?.email}
      metrics={metrics}
    >
      {error && <p className="error">{error}</p>}

      <div className="dashboard-shell-grid">
        <section className="card stack">
          <h2>Current organization</h2>
          {firstOrganization ? (
            <>
              <p><strong>{firstOrganization.name}</strong></p>
              <p className="muted">Status: {firstOrganization.subscriptionStatus}</p>
            </>
          ) : loading ? (
            <p className="muted">Loading organizations...</p>
          ) : (
            <p className="muted">Create an organization to get started.</p>
          )}
        </section>

        <section className="card stack">
          <h2>Execution posture</h2>
          <p className="muted">System checks for auth, org context, and API health are active.</p>
          <ul className="dashboard-shell-checklist">
            <li>{state.principal ? 'Authenticated principal detected' : 'Authenticating principal...'}</li>
            <li>{loading ? 'Refreshing organization state' : 'Organization state synchronized'}</li>
            <li>Structured notifications enabled</li>
          </ul>
        </section>
      </div>
    </DashboardShell>
  )
}
