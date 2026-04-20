'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  organizationsListInvitations,
  organizationsListOrganizations
} from '../../../lib/api/generated/organizations/organizations'
import { teamsListTeams } from '../../../lib/api/generated/teams/teams'

export default function OrgRedirectPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const resolve = async (): Promise<void> => {
      try {
        const orgs = await organizationsListOrganizations()

        if (orgs.data.length === 0) {
          const invitations = await organizationsListInvitations({
            'filter[status]': 'pending',
            limit: '1'
          })

          if (invitations.data.length > 0) {
            router.replace('/invitations')
            return
          }

          router.replace('/org/onboarding')
          return
        }

        const firstOrg = orgs.data[0]
        if (!firstOrg) {
          router.replace('/org/onboarding')
          return
        }

        const orgId = firstOrg.id
        const teams = await teamsListTeams({ organizationId: orgId })
        const firstTeam = teams.data[0]

        if (!firstTeam) {
          router.replace(`/org/${orgId}/workspaces`)
          return
        }

        router.replace(`/org/${orgId}/${firstTeam.id}`)
      } catch {
        setError('Failed to resolve organization context')
      }
    }

    void resolve()
  }, [router])

  if (error) {
    return (
      <section className="space-y-3" style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1.5rem' }}>
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </section>
    )
  }

  return null
}
