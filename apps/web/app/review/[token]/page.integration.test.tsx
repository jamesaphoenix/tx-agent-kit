import React from 'react'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { clearAuthToken, writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser, createOrganization, defaultTestBrandSettings } from '@tx-agent-kit/testkit'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import ReviewPage from '@/app/review/[token]/page'
import { renderWithProviders, screen, waitFor } from '../../../integration/test-utils'
import { createWebFactoryContext } from '../../../integration/support/web-integration-context'

function renderReviewPage(token: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ token }}>
      <ReviewPage />
    </PathParamsContext.Provider>
  )
}

const uid = randomUUID().slice(0, 8)

const setupTokenForReview = async () => {
  const factoryContext = createWebFactoryContext()
  const owner = await createUser(factoryContext, {
    email: `review-page-owner-${uid}-${randomUUID().slice(0, 4)}@example.com`,
    password: 'review-page-pass-12345',
    name: 'Review Page Owner'
  })

  writeAuthToken(owner.token)

  const org = await createOrganization(factoryContext, {
    token: owner.token,
    name: 'Review Test Organization'
  })

  const team = await clientApi.createTeam({
    organizationId: org.id,
    name: 'Review Test Workspace',
    brandSettings: defaultTestBrandSettings
  })

  const reviewToken = await clientApi.createReviewToken(team.id, {
    permissions: ['view', 'comment'],
    reviewerName: 'External Reviewer'
  })

  // Clear auth so we test public/unauthenticated access
  clearAuthToken()

  return { factoryContext, owner, org, team, reviewToken }
}

describe('ReviewPage integration', () => {
  beforeEach(() => {
    clearAuthToken()
  })

  it('renders review interface for valid token', async () => {
    const { reviewToken } = await setupTokenForReview()

    renderReviewPage(reviewToken.token)

    await waitFor(() => {
      expect(screen.getByText(/content review/i)).toBeInTheDocument()
    })

    expect(screen.queryByText(/invalid|expired|revoked/i)).not.toBeInTheDocument()
  })

  it('displays reviewer name and permissions', async () => {
    const { reviewToken } = await setupTokenForReview()

    renderReviewPage(reviewToken.token)

    await waitFor(() => {
      expect(screen.getByText('External Reviewer')).toBeInTheDocument()
    })

    // Use getAllByText because other elements on the page (e.g. "view_assets")
    // may also match /view/i after the assets permission was added.
    expect(screen.getAllByText(/view/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/comment/i).length).toBeGreaterThanOrEqual(1)
  })

  it('shows error for invalid token', async () => {
    renderReviewPage('invalid-token-value')

    await waitFor(() => {
      expect(screen.getByText(/invalid|expired|not found/i)).toBeInTheDocument()
    })
  })

  it('shows error for revoked token', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `review-revoke-owner-${uid}-${randomUUID().slice(0, 4)}@example.com`,
      password: 'review-revoke-pass-12345',
      name: 'Revoke Owner'
    })
    writeAuthToken(owner.token)

    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Revoke Test Org'
    })

    const revokeTeam = await clientApi.createTeam({
      organizationId: org.id,
      name: 'Revoke Test Workspace',
      brandSettings: {
        colors: { primary: '#6366F1', secondary: '#8B5CF6', accent: '#F59E0B', background: '#FFFFFF', text: '#1A1A2E' },
        brandGuidelines: 'Test brand guidelines',
        industry: 'technology',
        targetAudience: 'Test audience'
      }
    })

    const tokenToRevoke = await clientApi.createReviewToken(revokeTeam.id, {
      permissions: ['view'],
      reviewerName: 'Revoked Reviewer'
    })

    await clientApi.revokeReviewToken(revokeTeam.id, tokenToRevoke.id)

    // Clear auth for public access
    clearAuthToken()

    renderReviewPage(tokenToRevoke.token)

    await waitFor(() => {
      expect(screen.getByText(/invalid|expired|revoked|not found/i)).toBeInTheDocument()
    })
  })

  it('does not require authentication', async () => {
    const { reviewToken } = await setupTokenForReview()

    // Ensure no auth token is set
    clearAuthToken()

    renderReviewPage(reviewToken.token)

    await waitFor(() => {
      expect(screen.getByText(/content review/i)).toBeInTheDocument()
    })

    // Should NOT show any sign-in prompt or redirect
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
  })
})
