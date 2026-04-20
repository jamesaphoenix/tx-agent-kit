import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser, createOrganization, defaultTestBrandSettings } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceSettingsPage from '@/app/(application)/org/[orgId]/[teamId]/settings/page'
import { renderWithProviders, screen, userEvent, waitFor } from '../../../../../../integration/test-utils'
import { createWebFactoryContext } from '../../../../../../integration/support/web-integration-context'
import { readIntegrationRouterLocation } from '../../../../../../integration/support/next-router-context'

function renderWorkspaceSettings(orgId: string, teamId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId, teamId }}>
      <WorkspaceSettingsPage />
    </PathParamsContext.Provider>
  )
}

const openReviewTokensTab = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('tab', { name: /review tokens/i }))
}

const setupOwnerWithOrgAndTeam = async () => {
  const factoryContext = createWebFactoryContext()
  const owner = await createUser(factoryContext, {
    email: `ws-settings-owner-${randomUUID()}@example.com`,
    password: 'ws-settings-pass-12345',
    name: 'Workspace Settings Owner'
  })

  writeAuthToken(owner.token)

  const org = await createOrganization(factoryContext, {
    token: owner.token,
    name: 'Settings Test Organization'
  })

  const team = await clientApi.createTeam({
    organizationId: org.id,
    name: 'Settings Test Workspace',
    brandSettings: defaultTestBrandSettings
  })

  return { factoryContext, owner, org, team }
}

describe('WorkspaceSettingsPage integration', () => {
  it('renders workspace name and website', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()

    renderWorkspaceSettings(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Settings Test Workspace')).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/website/i)).toBeInTheDocument()
  })

  it('shows workspace profile first and switches to review token management', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)

    const profileTab = await screen.findByRole('tab', { name: /workspace profile/i })
    const reviewTokensTab = screen.getByRole('tab', { name: /review tokens/i })

    expect(profileTab).toHaveAttribute('aria-selected', 'true')
    expect(reviewTokensTab).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { name: /workspace profile/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /review tokens/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /danger zone/i })).toBeInTheDocument()

    await user.click(reviewTokensTab)

    expect(profileTab).toHaveAttribute('aria-selected', 'false')
    expect(reviewTokensTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: /review tokens/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /workspace profile/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /danger zone/i })).toBeInTheDocument()
  })

  it('owner can update workspace name', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Settings Test Workspace')).toBeInTheDocument()
    })

    const nameInput = screen.getByDisplayValue('Settings Test Workspace')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Workspace Name')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Updated Workspace Name')).toBeInTheDocument()
    })

    // Wait for the save button to finish (no longer shows "Saving...")
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
    })

    // Poll until the API reflects the persisted update
    await waitFor(async () => {
      const updatedTeam = await clientApi.getTeam(team.id)
      expect(updatedTeam.name).toBe('Updated Workspace Name')
    })
  })

  it('owner can update workspace website', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Settings Test Workspace')).toBeInTheDocument()
    })

    const websiteInput = screen.getByLabelText(/website/i)
    await user.clear(websiteInput)
    await user.type(websiteInput, 'https://example.com')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
    })

    // Wait for the save button to finish (no longer shows "Saving...")
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
    })

    // Poll until the API reflects the persisted update
    await waitFor(async () => {
      const updatedTeam = await clientApi.getTeam(team.id)
      expect(updatedTeam.website).toBe('https://example.com')
    })
  })

  it('owner can update workspace brand palette', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Settings Test Workspace')).toBeInTheDocument()
    })

    const primaryColorInput = screen.getByRole('textbox', { name: 'Primary' })
    await user.clear(primaryColorInput)
    await user.type(primaryColorInput, '#112233')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
    })

    await waitFor(async () => {
      const updatedTeam = await clientApi.getTeam(team.id)
      expect(updatedTeam.brandSettings?.colors.primary).toBe('#112233')
    })
  })

  it('owner can delete workspace', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Settings Test Workspace')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /delete/i }))

    // Confirm the delete dialog
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      const location = readIntegrationRouterLocation()
      expect(location.pathname).toMatch(new RegExp(`/org/${org.id}`))
      expect(location.pathname).not.toContain(team.id)
    })

    const teams = await clientApi.listTeams(org.id)
    expect(teams.data.some((t) => t.id === team.id)).toBe(false)
  })

  it('shows review token management', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)
    await openReviewTokensTab(user)

    // "Review Tokens" card title and "No review tokens yet." both match /review token/i,
    // so use getAllByText to tolerate multiple matches.
    await waitFor(() => {
      expect(screen.getAllByText(/review token/i).length).toBeGreaterThanOrEqual(1)
    })

    expect(await screen.findByRole('button', { name: /create.*token/i })).toBeInTheDocument()
  })

  it('owner can create a review token', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)
    await openReviewTokensTab(user)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create.*token/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /create.*token/i }))

    // Fill out the token creation form
    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/name/i), 'Test Review Token')
    await user.click(screen.getByRole('button', { name: /create$/i }))

    await waitFor(() => {
      expect(screen.getByText('Test Review Token')).toBeInTheDocument()
    })
  })

  it('owner can copy an active review token', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const createdToken = await clientApi.createReviewToken(team.id, {
      permissions: ['view'],
      reviewerName: 'Copy Token Reviewer'
    })
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const originalClipboard = window.navigator.clipboard
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })

    try {
      renderWorkspaceSettings(org.id, team.id)
      await openReviewTokensTab(user)

      await waitFor(() => {
        expect(screen.getByText('Copy Token Reviewer')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /copy token for copy token reviewer/i }))

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(createdToken.token)
      })
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true
      })
    }
  })

  it('owner can revoke a review token', async () => {
    const { org, team } = await setupOwnerWithOrgAndTeam()
    const user = userEvent.setup()

    renderWorkspaceSettings(org.id, team.id)
    await openReviewTokensTab(user)

    // First create a token
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create.*token/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /create.*token/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/name/i), 'Token To Revoke')
    await user.click(screen.getByRole('button', { name: /create$/i }))

    await waitFor(() => {
      expect(screen.getByText('Token To Revoke')).toBeInTheDocument()
    })

    // Now revoke the token — first click opens inline confirm UI
    await user.click(screen.getByRole('button', { name: /^revoke$/i }))

    // The component shows a "Confirm" button to finalize revocation
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^confirm$/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /^confirm$/i }))

    // After confirming, the token should disappear from the active list
    await waitFor(() => {
      expect(screen.queryByText('Token To Revoke')).not.toBeInTheDocument()
    })
  })
})
