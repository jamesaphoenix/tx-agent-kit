'use client'

import { DashboardShell } from '../../components/DashboardShell'
import { useCurrentPrincipal, useIsSessionReady } from '../../hooks/use-session-store'
import { useOrganizationsListOrganizations } from '../../lib/api/generated/organizations/organizations'

export default function DashboardPage() {
  const isSessionReady = useIsSessionReady()
  const principal = useCurrentPrincipal()

  const orgsQuery = useOrganizationsListOrganizations(undefined, {
    query: { enabled: isSessionReady }
  })

  const organizations = orgsQuery.data?.data ?? []
  const loading = orgsQuery.isLoading
  const error = orgsQuery.error ? 'Failed to load dashboard' : null
  const firstOrganization = organizations[0]

  return (
    <DashboardShell
      title="Operations Dashboard"
      subtitle={principal ? `Signed in as ${principal.email}` : 'Loading profile...'}
      principalEmail={principal?.email}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">Current organization</h2>
          {firstOrganization && (
            <>
              <p><strong>{firstOrganization.name}</strong></p>
              <p className="text-sm text-muted-foreground">Status: {firstOrganization.subscriptionStatus}</p>
            </>
          )}
          {!firstOrganization && loading && (
            <p className="text-sm text-muted-foreground">Loading organizations...</p>
          )}
          {!firstOrganization && !loading && (
            <p className="text-sm text-muted-foreground">Create an organization to get started.</p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">Execution posture</h2>
          <p className="text-sm text-muted-foreground">System checks for auth, org context, and API health are active.</p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>{principal ? 'Authenticated principal detected' : 'Authenticating principal...'}</li>
            <li>{loading ? 'Refreshing organization state' : 'Organization state synchronized'}</li>
            <li>Structured notifications enabled</li>
          </ul>
        </section>
      </div>
    </DashboardShell>
  )
}
