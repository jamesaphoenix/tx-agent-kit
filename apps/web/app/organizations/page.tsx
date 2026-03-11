'use client'

import type { Organization } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreateOrganizationForm } from '../../components/CreateOrganizationForm'
import { DashboardShell } from '../../components/DashboardShell'
import { useCurrentPrincipal, useIsSessionReady } from '../../hooks/use-session-store'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

export default function OrganizationsPage() {
  const router = useRouter()
  const isSessionReady = useIsSessionReady()
  const principal = useCurrentPrincipal()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!ensureSessionOrRedirect(router, '/organizations')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const payload = await clientApi.listOrganizations()
      setOrganizations(payload.data)
    } catch (error_) {
      if (handleUnauthorizedApiError(error_, router, '/organizations')) {
        return
      }

      setError(error_ instanceof Error ? error_.message : 'Failed to load organizations')
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

  const metrics = [
    {
      label: 'Organizations',
      value: String(organizations.length)
    },
    {
      label: 'Load state',
      value: loading ? 'Refreshing' : 'Current',
      tone: loading ? 'warning' as const : 'success' as const
    }
  ]

  return (
    <DashboardShell
      title="Organizations"
      subtitle="Manage team boundaries and operational ownership."
      principalEmail={principal?.email}
      metrics={metrics}
    >
      {error && <p className="error">{error}</p>}

      <div className="dashboard-shell-grid">
        <section className="card">
          <CreateOrganizationForm onCreated={load} />
        </section>

        <section className="card stack">
          <h2>Your organizations</h2>
          {organizations.length === 0 ? (
            <p className="muted">{loading ? 'Loading organizations...' : 'No organizations yet.'}</p>
          ) : (
            organizations.map((organization) => (
              <article key={organization.id} className="card" style={{ background: 'var(--surface-2)' }}>
                <strong>{organization.name}</strong>
                <p className="muted">Status: {organization.subscriptionStatus}</p>
              </article>
            ))
          )}
        </section>
      </div>
    </DashboardShell>
  )
}
