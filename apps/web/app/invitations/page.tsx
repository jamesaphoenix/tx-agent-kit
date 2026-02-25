'use client'

import type { Invitation, Organization } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardShell } from '../../components/DashboardShell'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'
import { notify } from '../../lib/notify'
import { useStringQueryParam } from '../../lib/url-state'

type InvitationWithOrgName = Invitation & { organizationName: string }

const statusColors: Record<string, string> = {
  pending: 'var(--warning, #f59e0b)',
  accepted: 'var(--success, #10b981)',
  revoked: 'var(--muted, #6b7280)',
  expired: 'var(--muted, #6b7280)'
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="invitation-status-badge"
      style={{
        color: statusColors[status] ?? 'var(--muted)',
        borderColor: statusColors[status] ?? 'var(--muted)'
      }}
    >
      {status}
    </span>
  )
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

export default function InvitationsPage() {
  const router = useRouter()
  const urlToken = useStringQueryParam('token')
  const [invitations, setInvitations] = useState<InvitationWithOrgName[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [principalEmail, setPrincipalEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const autoAcceptAttempted = useRef(false)

  const [inviteOrgId, setInviteOrgId] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [invitePending, setInvitePending] = useState(false)

  const [manualToken, setManualToken] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!ensureSessionOrRedirect(router, '/invitations')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [invitationsPayload, organizationsPayload, principal] = await Promise.all([
        clientApi.listInvitations(),
        clientApi.listOrganizations(),
        clientApi.me()
      ])

      const orgMap = new Map(organizationsPayload.data.map((o) => [o.id, o.name]))

      setInvitations(
        invitationsPayload.data.map((inv) => ({
          ...inv,
          organizationName: orgMap.get(inv.organizationId) ?? 'Unknown organization'
        }))
      )
      setOrganizations(organizationsPayload.data)
      setPrincipalEmail(principal.email)
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

  useEffect(() => {
    if (!urlToken || autoAcceptAttempted.current || loading) {
      return
    }

    autoAcceptAttempted.current = true
    const pendingInvitation = invitations.find((inv) => inv.token === urlToken)
    const accept = async () => {
      setAccepting(true)
      try {
        await clientApi.acceptInvitation(urlToken)
        notify.success('Invitation accepted! Redirecting...')
        await load()
        if (pendingInvitation) {
          router.push(`/org/${pendingInvitation.organizationId}/workspaces`)
        } else {
          router.push('/org')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to accept invitation'
        notify.error(message)
        setError(message)
      } finally {
        setAccepting(false)
      }
    }
    void accept()
  }, [urlToken, loading, invitations, load, router])

  const handleAcceptManual = async () => {
    if (!manualToken.trim()) {
      return
    }
    setAccepting(true)
    setError(null)
    try {
      await clientApi.acceptInvitation(manualToken.trim())
      setManualToken('')
      notify.success('Invitation accepted')
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept invitation'
      setError(message)
      notify.error(message)
    } finally {
      setAccepting(false)
    }
  }

  const handleRevoke = async (invitationId: string) => {
    setRevoking(invitationId)
    try {
      await clientApi.removeInvitation(invitationId)
      notify.success('Invitation revoked')
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke invitation'
      notify.error(message)
    } finally {
      setRevoking(null)
    }
  }

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!inviteOrgId || !inviteEmail.trim()) {
      return
    }

    setInvitePending(true)
    setError(null)
    try {
      await clientApi.createInvitation({
        organizationId: inviteOrgId,
        email: inviteEmail.trim(),
        role: inviteRole
      })
      setInviteEmail('')
      notify.success('Invitation sent')
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation'
      setError(message)
      notify.error(message)
    } finally {
      setInvitePending(false)
    }
  }

  const pendingInvitations = invitations.filter((inv) => inv.status === 'pending')
  const pastInvitations = invitations.filter((inv) => inv.status !== 'pending')

  const metrics = [
    {
      label: 'Pending invites',
      value: String(pendingInvitations.length),
      tone: pendingInvitations.length > 0 ? 'warning' as const : 'success' as const
    },
    {
      label: 'Organizations',
      value: String(organizations.length)
    },
    {
      label: 'Pipeline',
      value: accepting ? 'Processing' : 'Live',
      tone: accepting ? 'warning' as const : 'success' as const
    }
  ]

  if (accepting && urlToken) {
    return (
      <DashboardShell
        title="Invitations"
        subtitle="Processing invitation acceptance."
        principalEmail={principalEmail}
        metrics={metrics}
      >
        <section className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h2>Accepting invitation...</h2>
          <p className="muted">Please wait while we process your invitation.</p>
        </section>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell
      title="Invitations"
      subtitle="Send, accept, and revoke organization invitations from one command surface."
      principalEmail={principalEmail}
      metrics={metrics}
    >
      {error && <p className="error">{error}</p>}

      <section className="card stack">
        <h2>Invitation activity</h2>
        <p className="muted">Manage invite flow for each organization and route accepted invites into workspaces.</p>
      </section>

      <div className="dashboard-shell-grid">
        <section className="card">
          <form
            className="stack"
            onSubmit={(event) => { void handleInvite(event) }}
          >
            <h3>Invite a teammate</h3>
            <p className="muted" style={{ fontSize: '0.875rem' }}>
              They will receive an invitation token and can join immediately.
            </p>

            <label className="stack">
              <span>Organization</span>
              <select
                value={inviteOrgId}
                onChange={(event) => setInviteOrgId(event.target.value)}
              >
                <option value="">Select organization</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </label>

            <label className="stack">
              <span>Email address</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="colleague@example.com"
                required
              />
            </label>

            <label className="stack">
              <span>Role</span>
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as 'admin' | 'member')}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            <button type="submit" disabled={invitePending || !inviteOrgId}>
              {invitePending ? 'Sending...' : 'Send invitation'}
            </button>
          </form>
        </section>

        <section className="card">
          <div className="stack">
            <h3>Accept invitation token</h3>
            <p className="muted" style={{ fontSize: '0.875rem' }}>
              Paste a token from email to join the target organization.
            </p>
            <input
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Paste invitation token"
            />
            <button
              type="button"
              disabled={accepting || !manualToken.trim()}
              onClick={() => { void handleAcceptManual() }}
            >
              {accepting ? 'Accepting...' : 'Accept invitation'}
            </button>
          </div>
        </section>
      </div>

      {pendingInvitations.length > 0 && (
        <section className="card stack">
          <h2>Pending invitations</h2>
          <div className="invitation-list">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="invitation-card">
                <div className="invitation-card-main">
                  <div className="invitation-card-info">
                    <strong>{inv.email}</strong>
                    <span className="muted">{inv.organizationName}</span>
                  </div>
                  <div className="invitation-card-meta">
                    <span className="invitation-role">{inv.role}</span>
                    <StatusBadge status={inv.status} />
                    <span className="muted">{formatDate(inv.createdAt)}</span>
                  </div>
                </div>
                <div className="invitation-card-actions">
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    disabled={revoking === inv.id}
                    onClick={() => { void handleRevoke(inv.id) }}
                  >
                    {revoking === inv.id ? 'Revoking...' : 'Revoke'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card stack">
        <h2>Invitation history</h2>
        {loading && invitations.length === 0 ? (
          <p className="muted">Loading...</p>
        ) : pastInvitations.length === 0 && pendingInvitations.length === 0 ? (
          <p className="muted">No invitations yet.</p>
        ) : pastInvitations.length === 0 ? (
          <p className="muted">No past invitations.</p>
        ) : (
          <div className="invitation-list">
            {pastInvitations.map((inv) => (
              <div key={inv.id} className="invitation-card invitation-card--past">
                <div className="invitation-card-main">
                  <div className="invitation-card-info">
                    <strong>{inv.email}</strong>
                    <span className="muted">{inv.organizationName}</span>
                  </div>
                  <div className="invitation-card-meta">
                    <span className="invitation-role">{inv.role}</span>
                    <StatusBadge status={inv.status} />
                    <span className="muted">{formatDate(inv.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </DashboardShell>
  )
}
