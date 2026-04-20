'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { DashboardShell } from '../../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../../hooks/use-session-store'
import { notify } from '../../../../../../lib/notify'
import {
  useTeamsGetTeam,
  useTeamsUpdateTeam,
  useTeamsRemoveTeam,
  useTeamsListReviewTokens,
  useTeamsCreateReviewToken,
  useTeamsRevokeReviewToken,
  getTeamsGetTeamQueryKey,
  getTeamsListReviewTokensQueryKey
} from '../../../../../../lib/api/generated/teams/teams'
import { usePermissionsGetMyPermissions } from '../../../../../../lib/api/generated/permissions/permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  BrandSettingsFields,
  defaultBrandSettingsValues,
  type BrandSettingsValues
} from '@/components/BrandSettingsFields'

const settingsTabs = [
  { id: 'profile', label: 'Workspace profile' },
  { id: 'tokens', label: 'Review tokens' }
] as const

type SettingsTabId = (typeof settingsTabs)[number]['id']

export default function WorkspaceSettingsPage() {
  const router = useRouter()
  const params = useParams<{ orgId: string; teamId: string }>()
  const orgId = params.orgId
  const teamId = params.teamId
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()

  // ── Queries ──────────────────────────────────────────────────────────
  const teamQuery = useTeamsGetTeam(teamId)
  const tokensQuery = useTeamsListReviewTokens(teamId)
  const permissionsQuery = usePermissionsGetMyPermissions()

  const team = teamQuery.data ?? null
  const tokens = tokensQuery.data?.data ?? []
  const permissions = permissionsQuery.data ?? null
  const loading = teamQuery.isLoading
  const error = teamQuery.error ? 'Failed to load workspace' : null

  const invalidateTeam = () =>
    queryClient.invalidateQueries({ queryKey: getTeamsGetTeamQueryKey(teamId) })
  const invalidateTokens = () =>
    queryClient.invalidateQueries({ queryKey: getTeamsListReviewTokensQueryKey(teamId) })

  // ── Form state ───────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [brandSettings, setBrandSettings] = useState<BrandSettingsValues>(defaultBrandSettingsValues)
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showCreateToken, setShowCreateToken] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [revokeConfirmTokenId, setRevokeConfirmTokenId] = useState<string | null>(null)

  useEffect(() => {
    if (team) {
      setName(team.name)
      setWebsite(team.website ?? '')
      setBrandSettings(team.brandSettings ?? defaultBrandSettingsValues)
    }
  }, [team])

  // ── Mutations ────────────────────────────────────────────────────────
  const updateMutation = useTeamsUpdateTeam({
    mutation: {
      onSuccess: () => {
        notify.success('Workspace updated')
        void invalidateTeam()
      },
      onError: () => { notify.error('Failed to update workspace') }
    }
  })

  const deleteMutation = useTeamsRemoveTeam({
    mutation: {
      onSuccess: () => {
        notify.success('Workspace deleted')
        router.push(`/org/${orgId}/workspaces`)
      },
      onError: () => {
        notify.error('Failed to delete workspace')
        setShowDeleteDialog(false)
      }
    }
  })

  const createTokenMutation = useTeamsCreateReviewToken({
    mutation: {
      onSuccess: () => {
        setNewTokenName('')
        setShowCreateToken(false)
        notify.success('Review token created')
        void invalidateTokens()
      },
      onError: () => { notify.error('Failed to create review token') }
    }
  })

  const revokeTokenMutation = useTeamsRevokeReviewToken({
    mutation: {
      onSuccess: () => {
        setRevokeConfirmTokenId(null)
        notify.success('Review token revoked')
        void invalidateTokens()
      },
      onError: () => { notify.error('Failed to revoke review token') }
    }
  })

  const activeTokens = tokens.filter((t) => t.revokedAt === null)
  const isAdminOrOwner = permissions?.role === 'admin'
  const copyReviewToken = async (token: string, label: string) => {
    try {
      await window.navigator.clipboard.writeText(token)
      notify.success(`Copied token for ${label}`)
    } catch {
      notify.error('Failed to copy review token')
    }
  }

  return (
    <DashboardShell
      title="Workspace settings"
      subtitle="Manage workspace details, brand palette, review tokens, and danger zone actions."
      principalEmail={principal?.email}
      orgId={orgId}
      teamId={teamId}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && !team ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="grid gap-6">
          <div role="tablist" aria-label="Workspace settings sections" className="flex flex-wrap gap-2">
            {settingsTabs.map((tab) => {
              const selected = activeTab === tab.id

              return (
                <Button
                  key={tab.id}
                  id={`workspace-settings-${tab.id}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`workspace-settings-${tab.id}-panel`}
                  variant={selected ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </Button>
              )
            })}
          </div>

          <section
            id="workspace-settings-profile-panel"
            role="tabpanel"
            aria-labelledby="workspace-settings-profile-tab"
            hidden={activeTab !== 'profile'}
          >
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>
                  <h2>Workspace profile</h2>
                </CardTitle>
                <CardDescription>Update your workspace name, website, and brand palette.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Workspace title</Label>
                  <Input
                    id="workspace-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Workspace title"
                    minLength={2}
                    maxLength={64}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-website">Website</Label>
                  <Input
                    id="workspace-website"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://example.com"
                  />
                </div>
                <BrandSettingsFields
                  values={brandSettings}
                  onChange={setBrandSettings}
                  disabled={updateMutation.isPending}
                />
                <Button
                  type="button"
                  onClick={() => updateMutation.mutate({
                    teamId,
                    data: { name, website, brandSettings }
                  })}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </CardContent>
            </Card>
          </section>

          <section
            id="workspace-settings-tokens-panel"
            role="tabpanel"
            aria-labelledby="workspace-settings-tokens-tab"
            hidden={activeTab !== 'tokens'}
          >
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>
                  <h2>Review tokens</h2>
                </CardTitle>
                <CardDescription>Manage access tokens for external reviewers.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeTokens.length > 0 ? (
                  <ul className="space-y-2">
                    {activeTokens.map((token) => {
                      const tokenLabel = token.reviewerName ?? token.id

                      return (
                        <li key={token.id} className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-sm">{tokenLabel}</span>
                          {revokeConfirmTokenId === token.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">Revoke?</span>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={revokeTokenMutation.isPending}
                                onClick={() => revokeTokenMutation.mutate({ teamId, tokenId: token.id })}
                              >
                                {revokeTokenMutation.isPending ? 'Revoking...' : 'Confirm'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={revokeTokenMutation.isPending}
                                onClick={() => setRevokeConfirmTokenId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`Copy token for ${tokenLabel}`}
                                onClick={() => {
                                  void copyReviewToken(token.token, tokenLabel)
                                }}
                              >
                                Copy token
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setRevokeConfirmTokenId(token.id)}
                              >
                                Revoke
                              </Button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                ) : !showCreateToken && (
                  <div className="text-center py-6">
                    <p className="text-muted-foreground text-sm">No review tokens yet.</p>
                  </div>
                )}

                {showCreateToken ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="token-name">Name</Label>
                      <Input
                        id="token-name"
                        value={newTokenName}
                        onChange={(e) => setNewTokenName(e.target.value)}
                        placeholder="Reviewer name"
                        required
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => createTokenMutation.mutate({
                          teamId,
                          data: { permissions: ['view'], reviewerName: newTokenName.trim() }
                        })}
                        disabled={createTokenMutation.isPending || !newTokenName.trim()}
                      >
                        {createTokenMutation.isPending ? 'Creating...' : 'Create'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowCreateToken(false)
                          setNewTokenName('')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreateToken(true)}
                  >
                    Create Token
                  </Button>
                )}
              </CardContent>
            </Card>
          </section>

          {isAdminOrOwner && (
            <Card className="shadow-sm border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-destructive">
                  <h2>Danger zone</h2>
                </CardTitle>
                <CardDescription>
                  Deleting a workspace is permanent and cannot be undone.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  Delete workspace
                </Button>
              </CardContent>
            </Card>
          )}

          <Dialog
            open={showDeleteDialog}
            onOpenChange={(open) => {
              if (!deleteMutation.isPending) {
                setShowDeleteDialog(open)
              }
            }}
          >
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>Delete workspace</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete <strong>{team?.name}</strong>? This action
                  cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDeleteDialog(false)}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate({ teamId })}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </DashboardShell>
  )
}
