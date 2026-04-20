'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../hooks/use-session-store'
import { notify } from '../../../../../lib/notify'
import {
  useTeamsListTeams,
  useTeamsCreateTeam,
  useTeamsRemoveTeam,
  getTeamsListTeamsQueryKey
} from '../../../../../lib/api/generated/teams/teams'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { CreateWorkspaceDialog, type CreateWorkspaceDialogInput } from '@/components/CreateWorkspaceDialog'

export default function WorkspacesPage() {
  const router = useRouter()
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)

  const [deleteTeamId, setDeleteTeamId] = useState<string | null>(null)

  const teamsQuery = useTeamsListTeams(
    { organizationId: orgId },
    { query: {} }
  )

  const teams = teamsQuery.data?.data ?? []
  const loading = teamsQuery.isLoading
  const error = teamsQuery.error ? 'Failed to load workspaces' : null

  const invalidateTeams = () =>
    queryClient.invalidateQueries({ queryKey: getTeamsListTeamsQueryKey({ organizationId: orgId }) })

  const createMutation = useTeamsCreateTeam({
    mutation: {
      onSuccess: (data) => {
        notify.success(`Workspace "${data.name}" created`)
        setCreateOpen(false)
        void invalidateTeams()
        router.push(`/org/${orgId}/${data.id}`)
      },
      onError: () => { notify.error('Failed to create workspace') }
    }
  })

  const deleteMutation = useTeamsRemoveTeam({
    mutation: {
      onSuccess: () => {
        setDeleteTeamId(null)
        notify.success('Workspace deleted')
        void invalidateTeams()
      },
      onError: () => { notify.error('Failed to delete workspace') }
    }
  })

  const creating = createMutation.isPending

  const handleCreate = ({ name, website, brandSettings }: CreateWorkspaceDialogInput) => {
    if (!name.trim() || creating) {return}
    createMutation.mutate({
      data: {
        organizationId: orgId,
        name: name.trim(),
        website,
        brandSettings
      }
    })
  }

  const deleteTeam = teams.find(t => t.id === deleteTeamId) ?? null

  return (
    <DashboardShell
      title="Workspaces"
      subtitle="Choose a workspace or create a new one for this organization."
      principalEmail={principal?.email}
      orgId={orgId}
      teamId={teams[0]?.id}
      actions={
        <Button type="button" onClick={() => setCreateOpen(true)}>
          Create workspace
        </Button>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && teams.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {!loading && teams.length === 0 && (
          <p className="text-muted-foreground col-span-full text-center py-6">No workspaces yet. Create one to get started.</p>
        )}
        {teams.map((team) => (
            <Card
              key={team.id}
              className="relative cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
              onClick={() => router.push(`/org/${orgId}/${team.id}`)}
            >
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-1 right-1 h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                aria-label={`Delete workspace ${team.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteTeamId(team.id)
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </Button>
              <CardContent className="flex items-center gap-3 p-4">
                <Avatar>
                  <AvatarFallback
                    style={team.brandSettings ? { backgroundColor: team.brandSettings.colors.primary, color: team.brandSettings.colors.text } : undefined}
                  >
                    {team.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-sm">{team.name}</span>
                  {team.brandSettings && (
                    <div className="flex items-center gap-1 mt-0.5">
                      {[team.brandSettings.colors.primary, team.brandSettings.colors.secondary, team.brandSettings.colors.accent].map((color, i) => (
                        <div key={i} className="w-3 h-3 rounded-full border border-border" style={{ backgroundColor: color }} />
                      ))}
                      <span className="text-[10px] text-muted-foreground ml-1 truncate">{team.brandSettings.industry}</span>
                    </div>
                  )}
                  {team.website && (
                    <span className="text-xs text-muted-foreground truncate">{team.website}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

      </div>
      )}

      <CreateWorkspaceDialog
        open={createOpen}
        isCreating={creating}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />

      <Dialog open={deleteTeamId !== null} onOpenChange={(open) => { if (!open) {setDeleteTeamId(null)} }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTeam?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTeamId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteTeamId) {deleteMutation.mutate({ teamId: deleteTeamId })} }}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  )
}
