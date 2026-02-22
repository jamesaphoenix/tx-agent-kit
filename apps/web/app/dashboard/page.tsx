'use client'

import type { AuthPrincipal, Task, Workspace } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '../../components/AppNav'
import { CreateTaskForm } from '../../components/CreateTaskForm'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

interface DashboardState {
  principal: AuthPrincipal | null
  workspaces: Workspace[]
  tasks: Task[]
}

const emptyState: DashboardState = {
  principal: null,
  workspaces: [],
  tasks: []
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
      const workspacePayload = await clientApi.listWorkspaces()
      const firstWorkspace = workspacePayload.workspaces[0]
      const tasksPayload = firstWorkspace
        ? await clientApi.listTasks(firstWorkspace.id)
        : { tasks: [] }

      setState({
        principal,
        workspaces: workspacePayload.workspaces,
        tasks: tasksPayload.tasks
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

  const firstWorkspace = state.workspaces[0]

  return (
    <section className="stack">
      <AppNav />
      <header className="card stack">
        <h1>Dashboard</h1>
        <p className="muted">
          {state.principal ? `Signed in as ${state.principal.email}` : 'Loading profile...'}
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="grid grid-2">
        <section className="card stack">
          <h2>Current workspace</h2>
          {firstWorkspace ? (
            <>
              <p>{firstWorkspace.name}</p>
              <p className="muted">{state.tasks.length} task(s)</p>
            </>
          ) : loading ? (
            <p className="muted">Loading workspaces...</p>
          ) : (
            <p className="muted">Create a workspace to start tracking tasks.</p>
          )}
        </section>

        {firstWorkspace && (
          <section className="card">
            <CreateTaskForm workspaceId={firstWorkspace.id} onCreated={load} />
          </section>
        )}
      </div>

      <section className="card stack">
        <h2>Tasks</h2>
        {state.tasks.length === 0 ? (
          <p className="muted">No tasks yet.</p>
        ) : (
          state.tasks.map((task) => (
            <article key={task.id} className="card" style={{ background: 'var(--surface-2)' }}>
              <div className="stack">
                <strong>{task.title}</strong>
                {task.description && <p className="muted">{task.description}</p>}
                <small className="muted">Status: {task.status}</small>
              </div>
            </article>
          ))
        )}
      </section>
    </section>
  )
}
