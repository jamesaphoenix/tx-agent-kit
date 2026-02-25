'use client'

import type { Team } from '@tx-agent-kit/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { clientApi } from '../../../../../lib/client-api'
import { handleUnauthorizedApiError } from '../../../../../lib/client-auth'
import { notify } from '../../../../../lib/notify'

export default function WorkspacesPage() {
  const router = useRouter()
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const [teams, setTeams] = useState<Team[]>([])
  const [principalEmail, setPrincipalEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [result, principal] = await Promise.all([
        clientApi.listTeams(orgId),
        clientApi.me()
      ])
      setTeams(result.data)
      setPrincipalEmail(principal.email)
    } catch (err) {
      if (handleUnauthorizedApiError(err, router, `/org/${orgId}/workspaces`)) {
        return
      }
      setError(err instanceof Error ? err.message : 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [orgId, router])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!newTeamName.trim() || creating) {
      return
    }

    setCreating(true)
    try {
      const team = await clientApi.createTeam({ organizationId: orgId, name: newTeamName.trim() })
      notify.success(`Workspace "${team.name}" created`)
      setNewTeamName('')
      router.push(`/org/${orgId}/${team.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create workspace'
      notify.error(message)
    } finally {
      setCreating(false)
    }
  }

  const metrics = [
    {
      label: 'Workspaces',
      value: String(teams.length)
    },
    {
      label: 'Creation',
      value: creating ? 'Creating' : 'Ready',
      tone: creating ? 'warning' as const : 'success' as const
    },
    {
      label: 'State',
      value: loading ? 'Refreshing' : 'Current',
      tone: loading ? 'warning' as const : 'success' as const
    }
  ]

  return (
    <DashboardShell
      title="Workspace switchboard"
      subtitle="Choose a workspace or create a new one for this organization."
      principalEmail={principalEmail}
      orgId={orgId}
      teamId={teams[0]?.id}
      metrics={metrics}
    >
      {error && <p className="error">{error}</p>}

      <div className="workspace-grid">
        {loading && teams.length === 0 ? (
          <p className="muted">Loading workspaces...</p>
        ) : (
          teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className="workspace-card"
              onClick={() => router.push(`/org/${orgId}/${team.id}`)}
            >
              <div className="workspace-card-icon">
                {team.name.charAt(0).toUpperCase()}
              </div>
              <div className="workspace-card-info">
                <strong>{team.name}</strong>
                {team.website && <span className="muted">{team.website}</span>}
              </div>
            </button>
          ))
        )}

        <form className="workspace-create-card" onSubmit={(e) => { void handleCreate(e) }}>
          <h3>New workspace</h3>
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Workspace name"
            minLength={2}
            maxLength={64}
            required
          />
          <button type="submit" disabled={creating}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      </div>
    </DashboardShell>
  )
}
