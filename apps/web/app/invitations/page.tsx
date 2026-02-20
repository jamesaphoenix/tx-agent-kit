import type { Invitation, Workspace } from '@tx-agent-kit/contracts'
import { AppNav } from '../../components/AppNav'
import { AcceptInvitationForm } from '../../components/AcceptInvitationForm'
import { CreateInvitationForm } from '../../components/CreateInvitationForm'
import { backendFetch } from '../../lib/backend'
import { requireSession } from '../../lib/server-session'

export default async function InvitationsPage() {
  const { token } = await requireSession()

  const [invitationsPayload, workspacesPayload] = await Promise.all([
    backendFetch<{ invitations: Invitation[] }>('/v1/invitations', { method: 'GET' }, token),
    backendFetch<{ workspaces: Workspace[] }>('/v1/workspaces', { method: 'GET' }, token)
  ])

  return (
    <section className="stack">
      <AppNav />
      <header className="card stack">
        <h1>Team Invitations</h1>
        <p className="muted">Invite collaborators and accept invites across workspaces.</p>
      </header>

      <div className="grid grid-2">
        <section className="card">
          <CreateInvitationForm workspaces={workspacesPayload.workspaces} />
        </section>

        <section className="card">
          <AcceptInvitationForm />
        </section>
      </div>

      <section className="card stack">
        <h2>Invitation activity</h2>
        {invitationsPayload.invitations.length === 0 ? (
          <p className="muted">No invitations yet.</p>
        ) : (
          invitationsPayload.invitations.map((invitation) => (
            <article key={invitation.id} className="card" style={{ background: 'var(--surface-2)' }}>
              <div className="stack">
                <strong>{invitation.email}</strong>
                <p className="muted">Role: {invitation.role}</p>
                <p className="muted">Status: {invitation.status}</p>
                <code>{invitation.token}</code>
              </div>
            </article>
          ))
        )}
      </section>
    </section>
  )
}
