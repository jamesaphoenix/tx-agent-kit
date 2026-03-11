'use client'

import type { Organization } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardShell } from '../../components/DashboardShell'
import { useCurrentPrincipal, useIsSessionReady } from '../../hooks/use-session-store'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

export default function DashboardPage() {
  const router = useRouter()
  const isSessionReady = useIsSessionReady()
  const principal = useCurrentPrincipal()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!ensureSessionOrRedirect(router, '/dashboard')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const organizationPayload = await clientApi.listOrganizations()
      setOrganizations(organizationPayload.data)
    } catch (error_) {
      if (handleUnauthorizedApiError(error_, router, '/dashboard')) {
        return
      }

      setError(error_ instanceof Error ? error_.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (!isSessionReady) {
      return
    }

    void load()
  }, [isSessionReady, load])

  const firstOrganization = organizations[0]

  const metrics = [
    {
      label: 'Organizations',
      value: String(organizations.length)
    },
    {
      label: 'Session',
      value: principal ? 'Authenticated' : 'Checking',
      tone: principal ? 'success' as const : 'warning' as const
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
      subtitle={principal ? `Signed in as ${principal.email}` : 'Loading profile...'}
      principalEmail={principal?.email}
      metrics={metrics}
    >
      {error && <p className="error">{error}</p>}

      <div className="dashboard-shell-grid">
        <section className="card stack">
          <h2>Current organization</h2>
          {firstOrganization && (
            <>
              <p><strong>{firstOrganization.name}</strong></p>
              <p className="muted">Status: {firstOrganization.subscriptionStatus}</p>
            </>
          )}
          {!firstOrganization && loading && (
            <p className="muted">Loading organizations...</p>
          )}
          {!firstOrganization && !loading && (
            <p className="muted">Create an organization to get started.</p>
          )}
        </section>

        <section className="card stack">
          <h2>Execution posture</h2>
          <p className="muted">System checks for auth, org context, and API health are active.</p>
          <ul className="dashboard-shell-checklist">
            <li>{principal ? 'Authenticated principal detected' : 'Authenticating principal...'}</li>
            <li>{loading ? 'Refreshing organization state' : 'Organization state synchronized'}</li>
            <li>Structured notifications enabled</li>
          </ul>
        </section>
      </div>
    </DashboardShell>
  )
}
