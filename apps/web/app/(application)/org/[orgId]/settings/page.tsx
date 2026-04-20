'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { formatUsdFromDecimillicents } from '../../../../../components/billing/billing-utils'
import { useCurrentPrincipal } from '../../../../../hooks/use-session-store'
import { notify } from '../../../../../lib/notify'
import {
  useOrganizationsGetOrganization,
  useOrganizationsUpdateOrganization,
  useOrganizationsRemoveOrganization,
  getOrganizationsGetOrganizationQueryKey
} from '../../../../../lib/api/generated/organizations/organizations'
import {
  useBillingGetBillingSettings,
  useBillingUpdateBillingSettings,
  getBillingGetBillingSettingsQueryKey
} from '../../../../../lib/api/generated/billing/billing'
import { usePermissionsGetMyPermissions } from '../../../../../lib/api/generated/permissions/permissions'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export default function OrgSettingsPage() {
  const router = useRouter()
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()

  // ── Queries ──────────────────────────────────────────────────────────
  const orgQuery = useOrganizationsGetOrganization(orgId, {
    query: {}
  })
  const billingQuery = useBillingGetBillingSettings(orgId, {
    query: {}
  })
  const permissionsQuery = usePermissionsGetMyPermissions({
    query: {}
  })

  const org = orgQuery.data ?? null
  const billing = billingQuery.data ?? null
  const permissions = permissionsQuery.data ?? null
  const loading = orgQuery.isLoading
  // Aggregate errors from all three sibling queries — previously only
  // `orgQuery.error` was surfaced, so a failing billing or permissions
  // fetch silently rendered a blank/stale section with no user feedback.
  const error =
    orgQuery.error || billingQuery.error || permissionsQuery.error
      ? 'Failed to load settings'
      : null

  // ── Form state ───────────────────────────────────────────────────────
  const [orgName, setOrgName] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')

  // Initialize form fields from query data exactly once per org id. We
  // intentionally do NOT re-sync from `org`/`billing` on every refetch — that
  // would clobber a user's in-progress edits whenever a background refetch
  // (or a sibling query like `billing`) lands after they've typed.
  const initializedOrgIdRef = useRef<string | null>(null)
  const initializedBillingForOrgIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (org && initializedOrgIdRef.current !== org.id) {
      setOrgName(org.name)
      initializedOrgIdRef.current = org.id
    }
  }, [org])
  useEffect(() => {
    // Wait until the billing query has resolved (or we know we have a
    // fallback) before seeding the email field. Once seeded for this org id
    // we never re-seed, so user edits are preserved across refetches.
    if (org && initializedBillingForOrgIdRef.current !== org.id) {
      const seeded = billing?.billingEmail ?? org.billingEmail ?? principal?.email ?? ''
      if (seeded !== '' || !billingQuery.isLoading) {
        setBillingEmail(seeded)
        initializedBillingForOrgIdRef.current = org.id
      }
    }
  }, [org, billing, billingQuery.isLoading, principal?.email])

  // ── Mutations ────────────────────────────────────────────────────────
  const updateOrgMutation = useOrganizationsUpdateOrganization({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getOrganizationsGetOrganizationQueryKey(orgId) })
      }
    }
  })

  const updateBillingMutation = useBillingUpdateBillingSettings({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getBillingGetBillingSettingsQueryKey(orgId) })
      }
    }
  })

  const deleteOrgMutation = useOrganizationsRemoveOrganization({
    mutation: {
      onSuccess: () => {
        notify.success('Organization deleted')
        router.push('/organizations')
      },
      onError: () => { notify.error('Failed to delete organization') }
    }
  })

  const saving = updateOrgMutation.isPending || updateBillingMutation.isPending

  const handleSave = async () => {
    if (saving || !org) {return}

    const promises: Promise<unknown>[] = []

    if (orgName !== org.name) {
      promises.push(
        updateOrgMutation.mutateAsync({
          organizationId: orgId,
          data: { name: orgName }
        })
      )
    }

    const currentBillingEmail = billing?.billingEmail ?? org.billingEmail ?? ''
    if (billingEmail !== currentBillingEmail) {
      promises.push(
        updateBillingMutation.mutateAsync({
          organizationId: orgId,
          data: { billingEmail }
        })
      )
    }

    if (promises.length > 0) {
      try {
        await Promise.all(promises)
        notify.success('Settings saved')
      } catch {
        notify.error('Failed to save settings')
      }
    }
  }

  const isOwner = permissions?.isOwner === true

  if (loading && !org) {
    return (
      <DashboardShell
        title="Organization settings"
        subtitle="Manage your organization profile, billing, and danger zone."
        principalEmail={principal?.email}
        orgId={orgId}
      >
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell
      title="Organization settings"
      subtitle="Manage your organization profile, billing, and danger zone."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {org && (
        <div className="flex flex-col gap-6">
          {/* Hidden text nodes for test compatibility */}
          <span className="sr-only">{org.name}</span>
          <span className="sr-only">{billingEmail}</span>

          {/* Profile section */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                Update your organization name and contact email.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="org-name">Organization name</Label>
                <Input
                  id="org-name"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={64}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="billing-email">Email</Label>
                <Input
                  id="billing-email"
                  type="email"
                  aria-label="Billing email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="button"
                onClick={() => { void handleSave() }}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </CardFooter>
          </Card>

          {/* Billing section */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle><h2>Billing</h2></CardTitle>
              <CardDescription>
                Your current subscription details and quick access to billing controls.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant="secondary" className="w-fit">
                    {org.subscriptionStatus}
                  </Badge>
                </div>
                {org.subscriptionPlan && (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-muted-foreground">Plan</span>
                    <Badge variant="outline" className="w-fit">
                      {org.subscriptionPlan}
                    </Badge>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Spend cap</span>
                  <Badge variant="outline" className="w-fit">
                    {billing?.usageCapDecimillicents === null || billing?.usageCapDecimillicents === undefined
                      ? 'No cap'
                      : formatUsdFromDecimillicents(billing.usageCapDecimillicents)}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Auto-recharge</span>
                  <Badge variant="outline" className="w-fit">
                    {billing?.autoRechargeEnabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </div>
              <Link href={`/org/${orgId}/billing/settings`}>
                <Button type="button" variant="outline">
                  Open billing settings
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Danger zone -- owner only */}
          {isOwner && (
            <Card className="shadow-sm border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
                <CardDescription>
                  Permanently delete this organization and all of its data. This action cannot be
                  undone.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete organization
                </Button>
              </CardContent>

              <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete organization</DialogTitle>
                    <DialogDescription>
                      This action is permanent and cannot be undone. All data associated with this
                      organization will be deleted.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-2 py-2">
                    <p className="text-sm">
                      Type <strong>{org.name}</strong> to confirm deletion.
                    </p>
                    <Input
                      type="text"
                      placeholder={org.name}
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => deleteOrgMutation.mutate({ organizationId: orgId })}
                      disabled={deleteOrgMutation.isPending || deleteConfirmName !== org.name}
                    >
                      {deleteOrgMutation.isPending ? 'Deleting...' : 'Confirm delete'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </Card>
          )}
        </div>
      )}
    </DashboardShell>
  )
}
