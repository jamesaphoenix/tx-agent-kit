import type { Task, Workspace } from '@tx-agent-kit/contracts'
import { AppNav } from '../../components/AppNav'
import { CreateTaskForm } from '../../components/CreateTaskForm'
import { backendFetch } from '../../lib/backend'
import { requireSession } from '../../lib/server-session'

export default async function DashboardPage() {
  const { token, principal } = await requireSession()
  const workspacePayload = await backendFetch<{ workspaces: Workspace[] }>('/v1/workspaces', { method: 'GET' }, token)
  const firstWorkspace = workspacePayload.workspaces[0]

  const tasksPayload = firstWorkspace
    ? await backendFetch<{ tasks: Task[] }>(
        `/v1/tasks?workspaceId=${encodeURIComponent(firstWorkspace.id)}`,
        { method: 'GET' },
        token
      )
    : { tasks: [] as Task[] }

  return (
    <section className="stack">
      <AppNav />
      <header className="card stack">
        <h1>Dashboard</h1>
        <p className="muted">Signed in as {principal.email}</p>
      </header>

      <div className="grid grid-2">
        <section className="card stack">
          <h2>Current workspace</h2>
          {firstWorkspace ? (
            <>
              <p>{firstWorkspace.name}</p>
              <p className="muted">{tasksPayload.tasks.length} task(s)</p>
            </>
          ) : (
            <p className="muted">Create a workspace to start tracking tasks.</p>
          )}
        </section>

        {firstWorkspace && (
          <section className="card">
            <CreateTaskForm workspaceId={firstWorkspace.id} />
          </section>
        )}
      </div>

      <section className="card stack">
        <h2>Tasks</h2>
        {tasksPayload.tasks.length === 0 ? (
          <p className="muted">No tasks yet.</p>
        ) : (
          tasksPayload.tasks.map((task) => (
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
