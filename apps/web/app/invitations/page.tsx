'use client'

import type { InvitationAssignableRole } from '@tx-agent-kit/contracts'
import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { DashboardShell } from '../../components/DashboardShell'
import { useCurrentPrincipal, useIsSessionReady } from '../../hooks/use-session-store'
import { notify } from '../../lib/notify'
import { useStringQueryParam } from '../../lib/url-state'
import {
  useOrganizationsListInvitations,
  useOrganizationsListOrganizations,
  getOrganizationsListInvitationsQueryKey,
  getOrganizationsListOrganizationsQueryKey,
  organizationsAcceptInvitation,
  organizationsCreateInvitation,
  organizationsRemoveInvitation
} from '../../lib/api/generated/organizations/organizations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="border-yellow-500 bg-yellow-50 text-yellow-700">{status}</Badge>
    case 'accepted':
      return <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700">{status}</Badge>
    case 'revoked':
      return <Badge variant="outline" className="border-red-500 bg-red-50 text-red-700">{status}</Badge>
    case 'expired':
      return <Badge variant="outline" className="border-gray-400 bg-gray-50 text-gray-500">{status}</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
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
  const isSessionReady = useIsSessionReady()
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()
  const urlToken = useStringQueryParam('token')
  const autoAcceptAttempted = useRef(false)

  const [accepting, setAccepting] = useState(false)
  const [acceptingInvitationId, setAcceptingInvitationId] = useState<string | null>(null)
  const [acceptingOrganizationId, setAcceptingOrganizationId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [inviteOrgId, setInviteOrgId] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InvitationAssignableRole>('member')
  const [invitePending, setInvitePending] = useState(false)
  const [manualToken, setManualToken] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────
  const invitationsQuery = useOrganizationsListInvitations(undefined, {
    query: { enabled: isSessionReady }
  })
  const orgsQuery = useOrganizationsListOrganizations(undefined, {
    query: { enabled: isSessionReady }
  })

  const invitations = invitationsQuery.data?.data ?? []
  const organizations = orgsQuery.data?.data ?? []
  const loading = invitationsQuery.isLoading

  const orgMap = new Map(organizations.map((o) => [o.id, o.name]))
  const invitationsWithOrg = invitations.map((inv) => ({
    ...inv,
    organizationName: orgMap.get(inv.organizationId) ?? 'Organization invitation'
  }))

  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationsListInvitationsQueryKey() })
  const invalidateOrganizationContext = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationsListOrganizationsQueryKey() })

  // ── Auto-accept from URL token ───────────────────────────────────────
  useEffect(() => {
    if (!urlToken || autoAcceptAttempted.current || loading) {return}
    autoAcceptAttempted.current = true

    const pendingInvitation = invitationsWithOrg.find((inv) => inv.token === urlToken)
    const accept = async () => {
      setAccepting(true)
      try {
        await organizationsAcceptInvitation(urlToken)
        notify.success('Invitation accepted! Redirecting...')
        void invalidateInvitations()
        void invalidateOrganizationContext()
        if (pendingInvitation) {
          router.push(`/org/${pendingInvitation.organizationId}/workspaces`)
        } else {
          router.push('/org')
        }
      } catch {
        setError('Failed to accept invitation')
        notify.error('Failed to accept invitation')
      } finally {
        setAccepting(false)
      }
    }
    void accept()
  }, [urlToken, loading])

  const handleAcceptManual = async () => {
    if (!manualToken.trim()) {return}
    setAccepting(true)
    setError(null)
    try {
      await organizationsAcceptInvitation(manualToken.trim())
      setManualToken('')
      notify.success('Invitation accepted')
      void invalidateInvitations()
      void invalidateOrganizationContext()
    } catch {
      setError('Failed to accept invitation')
      notify.error('Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  const handleAcceptInvitation = async (invitation: { id: string; token: string; organizationId: string }) => {
    setAcceptingInvitationId(invitation.id)
    setError(null)
    try {
      await organizationsAcceptInvitation(invitation.token)
      notify.success('Invitation accepted')
      void invalidateInvitations()
      void invalidateOrganizationContext()
      router.push(`/org/${invitation.organizationId}/workspaces`)
    } catch {
      setError('Failed to accept invitation')
      notify.error('Failed to accept invitation')
    } finally {
      setAcceptingInvitationId(null)
    }
  }

  const handleAcceptOrganizationInvitations = async (organizationId: string) => {
    const matchingInvitations = pendingInvitations.filter((invitation) => invitation.organizationId === organizationId)
    if (matchingInvitations.length === 0) {return}

    setAcceptingOrganizationId(organizationId)
    setError(null)
    try {
      const results = await Promise.allSettled(
        matchingInvitations.map((invitation) => organizationsAcceptInvitation(invitation.token))
      )
      const acceptedCount = results.filter((result) => result.status === 'fulfilled').length
      const failedCount = results.length - acceptedCount

      void invalidateInvitations()
      void invalidateOrganizationContext()

      if (acceptedCount > 0) {
        if (failedCount > 0) {
          notify.info(
            `${acceptedCount} invitation${acceptedCount === 1 ? '' : 's'} accepted; ${failedCount} could not be accepted`
          )
        } else {
          notify.success(
            acceptedCount === 1
              ? 'Invitation accepted'
              : `${acceptedCount} invitations accepted`
          )
        }
        router.push(`/org/${organizationId}/workspaces`)
        return
      }

      setError('Failed to accept invitations')
      notify.error('Failed to accept invitations')
    } catch {
      setError('Failed to accept invitations')
      notify.error('Failed to accept invitations')
    } finally {
      setAcceptingOrganizationId(null)
    }
  }

  const handleRevoke = async (invitationId: string) => {
    setRevoking(invitationId)
    try {
      await organizationsRemoveInvitation(invitationId)
      notify.success('Invitation revoked')
      void invalidateInvitations()
    } catch {
      notify.error('Failed to revoke invitation')
    } finally {
      setRevoking(null)
    }
  }

  const handleInvite = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    if (!inviteOrgId || !inviteEmail.trim()) {return}

    setInvitePending(true)
    setError(null)
    try {
      await organizationsCreateInvitation({
        organizationId: inviteOrgId,
        email: inviteEmail.trim(),
        role: inviteRole
      })
      setInviteEmail('')
      notify.success('Invitation sent')
      void invalidateInvitations()
    } catch {
      notify.error('Failed to send invitation')
    } finally {
      setInvitePending(false)
    }
  }

  const pendingInvitations = invitationsWithOrg.filter((inv) => inv.status === 'pending')
  const pastInvitations = invitationsWithOrg.filter((inv) => inv.status !== 'pending')
  const pendingInvitationCountsByOrg = pendingInvitations.reduce<Map<string, number>>((counts, invitation) => {
    counts.set(invitation.organizationId, (counts.get(invitation.organizationId) ?? 0) + 1)
    return counts
  }, new Map())
  const firstPendingInvitationIdByOrg = pendingInvitations.reduce<Map<string, string>>((firstIds, invitation) => {
    if (!firstIds.has(invitation.organizationId)) {
      firstIds.set(invitation.organizationId, invitation.id)
    }
    return firstIds
  }, new Map())

  if (accepting && urlToken) {
    return (
      <DashboardShell
        title="Invitations"
        subtitle="Processing invitation acceptance."
        principalEmail={principal?.email}
      >
        <section className="rounded-xl border border-border bg-white p-12 shadow-sm text-center">
          <h2 className="text-base font-semibold">Accepting invitation...</h2>
          <p className="text-sm text-muted-foreground">Please wait while we process your invitation.</p>
        </section>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell
      title="Invitations"
      subtitle="Send, accept, and revoke organization invitations from one command surface."
      principalEmail={principal?.email}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3 mb-6">
        <h2 className="text-base font-semibold">Invitation activity</h2>
        <p className="text-sm text-muted-foreground">Manage invite flow for each organization and route accepted invites into workspaces.</p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <form
            className="space-y-3"
            onSubmit={(event) => { void handleInvite(event) }}
          >
            <h3 className="text-base font-semibold">Invite a teammate</h3>
            <p className="text-sm text-muted-foreground">
              They will receive an invitation token and can join immediately.
            </p>

            <div className="space-y-2">
              <Label htmlFor="invite-organization">Organization</Label>
              <select
                id="invite-organization"
                value={inviteOrgId}
                onChange={(event) => setInviteOrgId(event.target.value)}
                className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Select organization</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="colleague@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as InvitationAssignableRole)}
                className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <Button type="submit" disabled={invitePending || !inviteOrgId}>
              {invitePending ? 'Sending...' : 'Send invitation'}
            </Button>
          </form>
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <div className="space-y-3">
            <h3 className="text-base font-semibold">Accept invitation token</h3>
            <p className="text-sm text-muted-foreground">
              Paste a token from email to join the target organization.
            </p>
            <Input
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Paste invitation token"
            />
            <Button
              type="button"
              disabled={accepting || !manualToken.trim()}
              onClick={() => { void handleAcceptManual() }}
            >
              {accepting ? 'Accepting...' : 'Accept token'}
            </Button>
          </div>
        </section>
      </div>

      {pendingInvitations.length > 0 && (
        <section className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3 mt-6">
          <h2 className="text-base font-semibold">Pending invitations</h2>
          <div className="space-y-3">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} data-testid="invitation-row" className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-col">
                    <strong className="text-sm">{inv.email}</strong>
                    <span className="text-sm text-muted-foreground">{inv.organizationName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{inv.role}</Badge>
                    <Badge variant={inv.teamId ? 'secondary' : 'outline'}>
                      {inv.teamId ? 'Workspace scoped' : 'All workspaces'}
                    </Badge>
                    <StatusBadge status={inv.status} />
                    <span className="text-sm text-muted-foreground">{formatDate(inv.createdAt)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {firstPendingInvitationIdByOrg.get(inv.organizationId) === inv.id &&
                    (pendingInvitationCountsByOrg.get(inv.organizationId) ?? 0) > 1 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={acceptingOrganizationId === inv.organizationId}
                        onClick={() => { void handleAcceptOrganizationInvitations(inv.organizationId) }}
                      >
                        {acceptingOrganizationId === inv.organizationId
                          ? 'Accepting...'
                          : 'Accept all invitations from this organization'}
                      </Button>
                    ) : null}
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={acceptingInvitationId === inv.id || acceptingOrganizationId === inv.organizationId}
                    onClick={() => { void handleAcceptInvitation(inv) }}
                  >
                    {acceptingInvitationId === inv.id ? 'Accepting...' : 'Accept invitation'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={revoking === inv.id || acceptingOrganizationId === inv.organizationId}
                    onClick={() => { void handleRevoke(inv.id) }}
                  >
                    {revoking === inv.id ? 'Revoking...' : 'Revoke'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3 mt-6">
        <h2 className="text-base font-semibold">Invitation history</h2>
        {loading && invitations.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {!(loading && invitations.length === 0) && pastInvitations.length === 0 && pendingInvitations.length === 0 && (
          <p className="text-sm text-muted-foreground">No invitations yet.</p>
        )}
        {!(loading && invitations.length === 0) && pastInvitations.length === 0 && pendingInvitations.length > 0 && (
          <p className="text-sm text-muted-foreground">No past invitations.</p>
        )}
        {pastInvitations.length > 0 && (
          <div className="space-y-3">
            {pastInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-md border px-4 py-3 opacity-60">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-col">
                    <strong className="text-sm">{inv.email}</strong>
                    <span className="text-sm text-muted-foreground">{inv.organizationName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{inv.role}</Badge>
                    <StatusBadge status={inv.status} />
                    <span className="text-sm text-muted-foreground">{formatDate(inv.createdAt)}</span>
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
