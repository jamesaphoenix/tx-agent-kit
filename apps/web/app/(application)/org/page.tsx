'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../../../lib/client-api'
import { handleUnauthorizedApiError } from '../../../lib/client-auth'

export default function OrgRedirectPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const resolve = async (): Promise<void> => {
      try {
        const orgs = await clientApi.listOrganizations()

        if (orgs.data.length === 0) {
          router.replace('/org/onboarding')
          return
        }

        const firstOrg = orgs.data[0]
        if (!firstOrg) {
          router.replace('/org/onboarding')
          return
        }

        const orgId = firstOrg.id
        const teams = await clientApi.listTeams(orgId)
        const firstTeam = teams.data[0]

        if (!firstTeam) {
          router.replace(`/org/${orgId}/workspaces`)
          return
        }

        router.replace(`/org/${orgId}/${firstTeam.id}`)
      } catch (err) {
        if (handleUnauthorizedApiError(err, router, '/org')) {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to resolve organization context')
      }
    }

    void resolve()
  }, [router])

  if (error) {
    return (
      <section className="stack" style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1.5rem' }}>
        <div className="card stack">
          <h1>Something went wrong</h1>
          <p className="error">{error}</p>
        </div>
      </section>
    )
  }

  return null
}
