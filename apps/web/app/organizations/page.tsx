'use client'

import { useQueryClient } from '@tanstack/react-query'
import { CreateOrganizationForm } from '../../components/CreateOrganizationForm'
import { DashboardShell } from '../../components/DashboardShell'
import { useCurrentPrincipal, useIsSessionReady } from '../../hooks/use-session-store'
import {
  useOrganizationsListOrganizations,
  getOrganizationsListOrganizationsQueryKey
} from '../../lib/api/generated/organizations/organizations'

export default function OrganizationsPage() {
  const isSessionReady = useIsSessionReady()
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()

  const orgsQuery = useOrganizationsListOrganizations(undefined, {
    query: { enabled: isSessionReady }
  })

  const organizations = orgsQuery.data?.data ?? []
  const loading = orgsQuery.isLoading
  const error = orgsQuery.error ? 'Failed to load organizations' : null

  const handleCreated = () => {
    void queryClient.invalidateQueries({ queryKey: getOrganizationsListOrganizationsQueryKey() })
  }

  return (
    <DashboardShell
      title="Organizations"
      subtitle="Manage team boundaries and operational ownership."
      principalEmail={principal?.email}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <CreateOrganizationForm onCreated={handleCreated} />
        </section>

        <section className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">Your organizations</h2>
          {organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{loading ? 'Loading organizations...' : 'No organizations yet.'}</p>
          ) : (
            organizations.map((organization) => (
              <article key={organization.id} className="rounded-xl border border-border bg-secondary p-6 shadow-sm">
                <strong>{organization.name}</strong>
                <p className="text-sm text-muted-foreground">Status: {organization.subscriptionStatus}</p>
              </article>
            ))
          )}
        </section>
      </div>
    </DashboardShell>
  )
}
