'use client'

import type { Workspace } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '../../components/AppNav'
import { CreateWorkspaceForm } from '../../components/CreateWorkspaceForm'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

export default function WorkspacesPage() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!ensureSessionOrRedirect(router, '/workspaces')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const payload = await clientApi.listWorkspaces()
      setWorkspaces(payload.workspaces)
    } catch (err) {
      if (handleUnauthorizedApiError(err, router, '/workspaces')) {
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="stack">
      <AppNav />
      <header className="card stack">
        <h1>Workspaces</h1>
        <p className="muted">Manage team boundaries and operational ownership.</p>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="grid grid-2">
        <section className="card">
          <CreateWorkspaceForm onCreated={load} />
        </section>

        <section className="card stack">
          <h2>Your workspaces</h2>
          {workspaces.length === 0 ? (
            <p className="muted">{loading ? 'Loading workspaces...' : 'No workspaces yet.'}</p>
          ) : (
            workspaces.map((workspace) => (
              <article key={workspace.id} className="card" style={{ background: 'var(--surface-2)' }}>
                <strong>{workspace.name}</strong>
                <p className="muted">Owner: {workspace.ownerUserId}</p>
              </article>
            ))
          )}
        </section>
      </div>
    </section>
  )
}
