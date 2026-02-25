'use client'

import type { Organization } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreateOrganizationForm } from '../../components/CreateOrganizationForm'
import { DashboardShell } from '../../components/DashboardShell'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

export default function OrganizationsPage() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [principalEmail, setPrincipalEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!ensureSessionOrRedirect(router, '/organizations')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [payload, principal] = await Promise.all([
        clientApi.listOrganizations(),
        clientApi.me()
      ])
      setOrganizations(payload.data)
      setPrincipalEmail(principal.email)
    } catch (err) {
      if (handleUnauthorizedApiError(err, router, '/organizations')) {
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to load organizations')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

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
      principalEmail={principalEmail}
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
