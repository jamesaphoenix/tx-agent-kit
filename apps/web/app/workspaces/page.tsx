import type { Workspace } from '@tx-agent-kit/contracts'
import { AppNav } from '../../components/AppNav'
import { CreateWorkspaceForm } from '../../components/CreateWorkspaceForm'
import { backendFetch } from '../../lib/backend'
import { requireSession } from '../../lib/server-session'

export default async function WorkspacesPage() {
  const { token } = await requireSession()
  const payload = await backendFetch<{ workspaces: Workspace[] }>('/v1/workspaces', { method: 'GET' }, token)

  return (
    <section className="stack">
      <AppNav />
      <header className="card stack">
        <h1>Workspaces</h1>
        <p className="muted">Manage team boundaries and operational ownership.</p>
      </header>

      <div className="grid grid-2">
        <section className="card">
          <CreateWorkspaceForm />
        </section>

        <section className="card stack">
          <h2>Your workspaces</h2>
          {payload.workspaces.length === 0 ? (
            <p className="muted">No workspaces yet.</p>
          ) : (
            payload.workspaces.map((workspace) => (
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
