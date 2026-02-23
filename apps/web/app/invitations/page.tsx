'use client'

import type { Invitation, Workspace } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AcceptInvitationForm } from '../../components/AcceptInvitationForm'
import { AppNav } from '../../components/AppNav'
import { CreateInvitationForm } from '../../components/CreateInvitationForm'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

interface InvitationState {
  invitations: Invitation[]
  workspaces: Workspace[]
}

const emptyState: InvitationState = {
  invitations: [],
  workspaces: []
}

export default function InvitationsPage() {
  const router = useRouter()
  const [state, setState] = useState<InvitationState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!ensureSessionOrRedirect(router, '/invitations')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [invitationsPayload, workspacesPayload] = await Promise.all([
        clientApi.listInvitations(),
        clientApi.listWorkspaces()
      ])

      setState({
        invitations: invitationsPayload.data,
        workspaces: workspacesPayload.data
      })
    } catch (err) {
      if (handleUnauthorizedApiError(err, router, '/invitations')) {
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to load invitations')
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
        <h1>Team Invitations</h1>
        <p className="muted">Invite collaborators and accept invites across workspaces.</p>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="grid grid-2">
        <section className="card">
          <CreateInvitationForm workspaces={state.workspaces} onCreated={load} />
        </section>

        <section className="card">
          <AcceptInvitationForm onAccepted={load} />
        </section>
      </div>

      <section className="card stack">
        <h2>Invitation activity</h2>
        {state.invitations.length === 0 ? (
          <p className="muted">{loading ? 'Loading invitations...' : 'No invitations yet.'}</p>
        ) : (
          state.invitations.map((invitation) => (
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
