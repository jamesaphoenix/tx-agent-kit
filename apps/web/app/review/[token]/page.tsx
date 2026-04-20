'use client'

import { useParams } from 'next/navigation'
import { useTeamsValidateReviewToken } from '../../../lib/api/generated/teams/teams'

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>()

  const { data: validation, isLoading, error } = useTeamsValidateReviewToken(token, {
    query: { enabled: !!token }
  })

  if (isLoading) {
    return (
      <section className="mx-auto max-w-xl mt-8 rounded-lg border bg-card p-6">
        <div className="space-y-4">
          <p className="text-muted-foreground">Validating review link...</p>
        </div>
      </section>
    )
  }

  if (error || !validation?.valid) {
    return (
      <section className="mx-auto max-w-xl mt-8 rounded-lg border bg-card p-6">
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">Review Unavailable</h1>
          <p className="text-destructive">
            {error ? 'Failed to validate review token' : 'This review link is invalid, expired, or has been revoked.'}
          </p>
        </div>
      </section>
    )
  }

  const reviewerName = validation.token?.reviewerName ?? 'Anonymous Reviewer'
  const permissions = validation.permissions ?? []

  return (
    <section className="mx-auto max-w-3xl mt-8 rounded-lg border bg-card p-6">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Content Review</h1>
        <p className="text-muted-foreground">
          Welcome, <strong>{reviewerName}</strong>. You have been invited to review content.
        </p>

        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-lg font-medium">Your Permissions</h2>
          <ul className="flex flex-wrap gap-2 list-none p-0">
            {permissions.map((permission) => (
              <li
                key={permission}
                className="px-3 py-1 rounded-md bg-primary/10 text-primary text-sm font-medium"
              >
                {permission}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-lg font-medium">Review Content</h2>
          <p className="text-muted-foreground">
            Content items for this workspace will appear here once they are published for review.
          </p>
        </div>
      </div>
    </section>
  )
}
