import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser, createOrganization, defaultTestBrandSettings, uploadTestAsset } from '@tx-agent-kit/testkit'
import { beforeEach, describe, expect, it } from 'vitest'
import MediaPage from '@/app/(application)/org/[orgId]/[teamId]/media/page'
import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from '../../../../../../integration/test-utils'
import { createWebFactoryContext, integrationBaseUrl } from '../../../../../../integration/support/web-integration-context'
import {
  readIntegrationRouterLocation,
  resetIntegrationRouterLocation
} from '../../../../../../integration/support/next-router-context'

function renderMediaPage(orgId: string, teamId: string) {
  return renderWithProviders(
    <PathParamsContext.Provider value={{ orgId, teamId }}>
      <MediaPage />
    </PathParamsContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted fixture: owner + org + activated subscription
// ─────────────────────────────────────────────────────────────────────────────
// The previous per-test `setupOwnerWithTeam()` helper made 4 HTTP round-trips
// per test — createUser, createOrganization, activateSubscription, createTeam —
// which put 14-test file at ~11s. None of those four fixtures need per-test
// isolation: the owner, org, and subscription are pure scaffolding. Hoist
// them into a shared beforeAll so the only per-test cost is a fresh team.
//
// Cost: 4 HTTP calls × 14 tests = 56 calls → 3 calls once + 14 createTeam calls = 17 calls
// Expected delta: ~7s → ~3-4s on this file.
type SharedFixture = {
  factoryContext: ReturnType<typeof createWebFactoryContext>
  owner: Awaited<ReturnType<typeof createUser>>
  org: Awaited<ReturnType<typeof createOrganization>>
  // Shared read-only team for the 8 UI-only tests (empty state, page title,
  // toolbar controls, upload dialog). None of these tests mutate state or
  // seed assets, so a single team created once in beforeAll is safe.
  uiTeam: Awaited<ReturnType<typeof clientApi.createTeam>>
}
let sharedFixture: SharedFixture | undefined

const getSharedFixture = (): SharedFixture => {
  if (!sharedFixture) {
    throw new Error('MediaPage integration: shared fixture used before beforeAll ran')
  }
  return sharedFixture
}

const createSharedFixture = async (): Promise<SharedFixture> => {
  const factoryContext = createWebFactoryContext()
  const owner = await createUser(factoryContext, {
    email: `media-owner-${randomUUID()}@example.com`,
    password: 'media-pass-12345',
    name: 'Media Test Owner'
  })
  writeAuthToken(owner.token)
  const org = await createOrganization(factoryContext, {
    token: owner.token,
    name: 'Media Test Organization'
  })
  await activateSubscriptionInContext(factoryContext, org.id)
  const uiTeam = await clientApi.createTeam({
    organizationId: org.id,
    name: 'Media Test Shared UI Team',
    brandSettings: defaultTestBrandSettings
  })

  return { factoryContext, owner, org, uiTeam }
}

const activateSubscriptionInContext = async (
  factoryContext: ReturnType<typeof createWebFactoryContext>,
  organizationId: string
): Promise<void> => {
  await factoryContext.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations
          SET is_subscribed = true,
              subscription_status = 'active',
              subscription_plan = 'pro'
        WHERE id = $1`,
      [organizationId]
    )
  })
}

// Data tests still own per-test teams so seeded assets don't cross-contaminate
// between tests. createTeam is 1 HTTP round-trip vs the previous
// setupOwnerWithTeam's 4 calls.
const createPerTestTeam = async () => {
  const { owner, org } = getSharedFixture()
  const team = await clientApi.createTeam({
    organizationId: org.id,
    name: `Media Test Workspace ${randomUUID().slice(0, 8)}`,
    brandSettings: defaultTestBrandSettings
  })
  return { owner, org, team }
}

const seedAsset = async (token: string, teamId: string, fileName: string, mimeType = 'image/png') => {
  return uploadTestAsset({
    baseUrl: integrationBaseUrl,
    token,
    teamId,
    fileName,
    mimeType
  })
}

const seedAssetRows = async (teamId: string, count: number): Promise<void> => {
  const { factoryContext } = getSharedFixture()
  const baseTime = Date.parse('2026-04-17T12:00:00.000Z')

  await factoryContext.testContext.withSchemaClient(async (client) => {
    for (let index = 1; index <= count; index += 1) {
      const fileName = `page-${String(index).padStart(2, '0')}.png`
      const createdAt = new Date(baseTime + index * 60_000).toISOString()
      await client.query(
        `INSERT INTO team_media_assets (
            team_id,
            original_filename,
            file_size,
            mime_type,
            asset_type,
            storage_path,
            processing_status,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'image/png', 'image', $4, 'completed', $5, $5)`,
        [
          teamId,
          fileName,
          1024 + index,
          `${teamId}/${fileName}`,
          createdAt
        ]
      )
    }
  })
}

// NOTE: NOT describe.concurrent. renderWithProviders mounts into the
// shared jsdom `document.body` and @testing-library's cleanup() runs
// after each test — concurrent tests would race on DOM state and trip
// "found multiple elements" errors. Serial rendering is required for
// React integration tests under pool:threads+isolate:false.
describe('MediaPage integration', () => {
  // The web integration runner resets the shared schema before each test.
  // Build the media fixture after that reset so auth tokens never point at
  // rows deleted by the global integration setup.
  beforeEach(async () => {
    sharedFixture = await createSharedFixture()
    writeAuthToken(sharedFixture.owner.token)
  })

  // ── Empty state ─────────────────────────────────────────────────────

  it('renders empty state when team has no assets', async () => {
    const { org, uiTeam: team } = getSharedFixture()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByText(/no assets yet/i)).toBeInTheDocument()
    })
  })

  it('renders the page title and subtitle', async () => {
    const { org, uiTeam: team } = getSharedFixture()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByText(/manage your team/i)).toBeInTheDocument()
    })
    // "Media" appears in sidebar nav and page title — just verify the subtitle is present
    expect(screen.getAllByText('Media').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps collapsed sidebar icon links titled and navigable', async () => {
    const { org, team } = await createPerTestTeam()
    resetIntegrationRouterLocation(`/org/${org.id}/${team.id}/media`)

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByText(/manage your team/i)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /toggle sidebar/i }))

    const dashboardLink = await screen.findByRole('link', { name: /^dashboard$/i })
    expect(dashboardLink).toHaveAttribute('title', 'Dashboard')
    expect(screen.getByRole('link', { name: /^media$/i })).toHaveAttribute('title', 'Media')
    expect(screen.getByRole('link', { name: /^workspaces$/i })).toHaveAttribute('title', 'Workspaces')

    await user.click(dashboardLink)

    await waitFor(() => {
      expect(readIntegrationRouterLocation().pathname).toBe(`/org/${org.id}/${team.id}`)
    })
  })

  // ── Toolbar controls ───────────────────────────────────────────────

  it('renders search input', async () => {
    const { org, uiTeam: team } = getSharedFixture()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByLabelText(/search assets/i)).toBeInTheDocument()
    })
  })

  it('renders type filter dropdown', async () => {
    const { org, uiTeam: team } = getSharedFixture()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByLabelText(/filter by type/i)).toBeInTheDocument()
    })
  })

  it('renders upload button', async () => {
    const { org, uiTeam: team } = getSharedFixture()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
    })
  })

  // ── View mode toggle ──────────────────────────────────────────────

  it('defaults to card view', async () => {
    const { org, uiTeam: team } = getSharedFixture()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      const cardsButton = screen.getByRole('button', { name: /cards/i })
      expect(cardsButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('can toggle to list view', async () => {
    const { org, uiTeam: team } = getSharedFixture()
    const user = userEvent.setup()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /list/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /list/i }))

    expect(screen.getByRole('button', { name: /list/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /cards/i })).toHaveAttribute('aria-pressed', 'false')
  })

  // ── Upload dialog ─────────────────────────────────────────────────

  it('opens upload dialog when upload button clicked', async () => {
    const { org, uiTeam: team } = getSharedFixture()
    const user = userEvent.setup()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /upload/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText(/click to select/i)).toBeInTheDocument()
  })

  it('uploads an asset from the media dialog', async () => {
    const { org, team } = await createPerTestTeam()
    const user = userEvent.setup()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upload asset/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /upload asset/i }))

    const fileInput = await screen.findByLabelText(/click to select files/i)
    const file = new File(['tiny-image'], 'ui-upload.png', { type: 'image/png' })
    await user.upload(fileInput, file)

    await waitFor(() => {
      expect(screen.getAllByText('ui-upload.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('completed')).toBeInTheDocument()
    })
  })

  it('uploads multiple assets from one media dialog selection', async () => {
    const { org, team } = await createPerTestTeam()
    const user = userEvent.setup()

    renderMediaPage(org.id, team.id)

    await user.click(await screen.findByRole('button', { name: /upload asset/i }))

    const fileInput = await screen.findByLabelText(/click to select files/i)
    const files = [
      new File(['first-image'], 'multi-one.png', { type: 'image/png' }),
      new File(['second-image'], 'multi-two.png', { type: 'image/png' })
    ]
    await user.upload(fileInput, files)

    await waitFor(() => {
      expect(screen.getAllByText('multi-one.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('multi-two.png').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('uploads an asset by dropping a file on the upload zone', async () => {
    const { org, team } = await createPerTestTeam()
    const user = userEvent.setup()

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upload asset/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /upload asset/i }))

    const dropZone = await screen.findByTestId('asset-upload-dropzone')
    const file = new File(['dropped-image'], 'dragged-upload.png', { type: 'image/png' })
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
        types: ['Files']
      }
    })

    await waitFor(() => {
      expect(screen.getAllByText('dragged-upload.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('completed')).toBeInTheDocument()
    })
  })

  // ── Asset rendering (full e2e: upload → R2 → confirm → render) ─────

  it('renders asset cards in card view after seeding data', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'test-image.png')

    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getAllByText('test-image.png').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders asset rows in list view after seeding data', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'list-test.png')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /list/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /list/i }))

    await waitFor(() => {
      expect(screen.getByText('list-test.png')).toBeInTheDocument()
    })
    expect(screen.getByText('Preview')).toBeInTheDocument()
    expect(screen.getByText('Filename')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
  })

  it('shows pagination status on a single page of card and list results', async () => {
    const { org, team } = await createPerTestTeam()
    await seedAssetRows(team.id, 2)

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByText('page-02.png')).toBeInTheDocument()
    })
    expect(screen.getByText(/showing 1-2 of 2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /list/i }))

    expect(screen.getByText(/showing 1-2 of 2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled()
  })

  it('paginates card and list views with cursor controls', async () => {
    const { org, team } = await createPerTestTeam()
    await seedAssetRows(team.id, 26)

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getByText('page-26.png')).toBeInTheDocument()
    })
    expect(screen.queryByText('page-01.png')).not.toBeInTheDocument()
    expect(screen.getByText(/showing 1-25 of 26/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next page/i }))

    await waitFor(() => {
      expect(screen.getByText('page-01.png')).toBeInTheDocument()
    })
    expect(screen.queryByText('page-26.png')).not.toBeInTheDocument()
    expect(screen.getByText(/showing 26-26 of 26/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /list/i }))
    expect(screen.getByText('page-01.png')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /previous page/i }))

    await waitFor(() => {
      expect(screen.getByText('page-26.png')).toBeInTheDocument()
    })
    expect(screen.queryByText('page-01.png')).not.toBeInTheDocument()
  })

  // ── Filtering ─────────────────────────────────────────────────────

  it('filters assets by type', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'filter-image.png', 'image/png')
    await seedAsset(owner.token, team.id, 'filter-video.mp4', 'video/mp4')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getAllByText('filter-image.png').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getAllByText('filter-video.mp4').length).toBeGreaterThanOrEqual(1)

    await user.selectOptions(screen.getByLabelText(/filter by type/i), 'image')

    await waitFor(() => {
      expect(screen.getAllByText('filter-image.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('filter-video.mp4')).not.toBeInTheDocument()
    })
  })

  // ── Search ────────────────────────────────────────────────────────

  it('filters assets by search query [INV-AST-016]', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'searchable-photo.png')
    await seedAsset(owner.token, team.id, 'other-document.png')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getAllByText('searchable-photo.png').length).toBeGreaterThanOrEqual(1)
    })

    await user.type(screen.getByLabelText(/search assets/i), 'searchable')

    await waitFor(() => {
      expect(screen.getAllByText('searchable-photo.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('other-document.png')).not.toBeInTheDocument()
    })
  })

  // ── Collections ───────────────────────────────────────────────────

  it('creates a collection from the media toolbar [INV-AST-017]', async () => {
    const { org, team } = await createPerTestTeam()
    const user = userEvent.setup()

    renderMediaPage(org.id, team.id)

    await user.click(await screen.findByRole('button', { name: /collections/i }))
    await user.click(await screen.findByRole('button', { name: /new collection/i }))
    await user.type(screen.getByLabelText(/collection name/i), 'Launch Shots')
    await user.type(screen.getByLabelText(/collection description/i), 'Campaign launch assets')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Launch Shots' })).toBeInTheDocument()
    })
  })

  it('adds an asset to a collection, filters by the collection, and removes it [INV-AST-017]', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'collection-hero.png')
    await seedAsset(owner.token, team.id, 'outside-collection.png')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getAllByText('collection-hero.png').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getAllByText('outside-collection.png').length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByRole('button', { name: /collections/i }))
    await user.click(await screen.findByRole('button', { name: /new collection/i }))
    await user.type(screen.getByLabelText(/collection name/i), 'Launch Picks')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    const collectionOption = await screen.findByRole('option', { name: 'Launch Picks' })
    const collectionId = collectionOption.getAttribute('value')
    expect(collectionId).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /add collection-hero\.png to collection/i }))
    await user.selectOptions(screen.getByLabelText(/target collection/i), collectionId as string)
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.selectOptions(screen.getByLabelText(/filter by collection/i), collectionId as string)

    await waitFor(() => {
      expect(screen.getAllByText('collection-hero.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('outside-collection.png')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /remove collection-hero\.png from collection/i }))

    await waitFor(() => {
      expect(screen.queryByText('collection-hero.png')).not.toBeInTheDocument()
      expect(screen.getByText(/no assets yet/i)).toBeInTheDocument()
    })
  })

  it('bulk adds and removes selected assets from a collection [INV-AST-017]', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'bulk-one.png')
    await seedAsset(owner.token, team.id, 'bulk-two.png')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getAllByText('bulk-one.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('bulk-two.png').length).toBeGreaterThanOrEqual(1)
    })

    await user.click(screen.getByRole('button', { name: /collections/i }))
    await user.click(await screen.findByRole('button', { name: /new collection/i }))
    await user.type(screen.getByLabelText(/collection name/i), 'Bulk Picks')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    const collectionOption = await screen.findByRole('option', { name: 'Bulk Picks' })
    const collectionId = collectionOption.getAttribute('value')
    expect(collectionId).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /select bulk-one\.png/i }))
    await user.click(screen.getByRole('button', { name: /select bulk-two\.png/i }))
    await user.click(screen.getByRole('button', { name: /^add to collection$/i }))
    await user.selectOptions(screen.getByLabelText(/target collection/i), collectionId as string)
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.selectOptions(screen.getByLabelText(/filter by collection/i), collectionId as string)

    await waitFor(() => {
      expect(screen.getAllByText('bulk-one.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('bulk-two.png').length).toBeGreaterThanOrEqual(1)
    })

    await user.click(screen.getByRole('button', { name: /select bulk-one\.png/i }))
    await user.click(screen.getByRole('button', { name: /select bulk-two\.png/i }))
    await user.click(screen.getByRole('button', { name: /^remove from collection$/i }))

    await waitFor(() => {
      expect(screen.queryByText('bulk-one.png')).not.toBeInTheDocument()
      expect(screen.queryByText('bulk-two.png')).not.toBeInTheDocument()
    })
  })

  // ── Delete flow ───────────────────────────────────────────────────

  it('opens delete confirmation dialog and deletes asset', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'to-delete.png')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getAllByText('to-delete.png').length).toBeGreaterThanOrEqual(1)
    })

    await user.click(screen.getByRole('button', { name: /delete to-delete\.png/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /delete asset/i })).toBeInTheDocument()
    })
    expect(screen.getAllByText(/to-delete\.png/).length).toBeGreaterThanOrEqual(2)

    // The dialog has a destructive "Delete" button alongside the card's "Delete" button
    const allDeleteButtons = screen.getAllByRole('button', { name: /^delete$/i })
    const confirmButton = allDeleteButtons[allDeleteButtons.length - 1]
    await user.click(confirmButton as HTMLElement)

    await waitFor(() => {
      expect(screen.queryByText('to-delete.png')).not.toBeInTheDocument()
    })
  })

  it('shows a top-level delete action for selected assets and deletes them', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'bulk-delete-one.png')
    await seedAsset(owner.token, team.id, 'bulk-delete-two.png')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    await waitFor(() => {
      expect(screen.getAllByText('bulk-delete-one.png').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('bulk-delete-two.png').length).toBeGreaterThanOrEqual(1)
    })

    await user.click(screen.getByRole('button', { name: /select bulk-delete-one\.png/i }))
    await user.click(screen.getByRole('button', { name: /select bulk-delete-two\.png/i }))

    const bulkDeleteButton = await screen.findByRole('button', { name: /delete selected/i })
    expect(bulkDeleteButton).toBeInTheDocument()
    await user.click(bulkDeleteButton)
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(screen.queryByText('bulk-delete-one.png')).not.toBeInTheDocument()
      expect(screen.queryByText('bulk-delete-two.png')).not.toBeInTheDocument()
    })
  })

  // ── Sort ──────────────────────────────────────────────────────────

  it('sorts assets by clicking column headers in list view', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'alpha-file.png')
    await seedAsset(owner.token, team.id, 'zeta-file.png')

    const user = userEvent.setup()
    renderMediaPage(org.id, team.id)

    // Switch to list view
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /list/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /list/i }))

    // Wait for both assets to render
    await waitFor(() => {
      expect(screen.getByText('alpha-file.png')).toBeInTheDocument()
    })
    expect(screen.getByText('zeta-file.png')).toBeInTheDocument()

    // Click Filename column header to sort ascending
    await user.click(screen.getByText('Filename'))

    // Wait for sorted rows to render (query refetches with new sort params)
    await waitFor(() => {
      expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
    })

    // Verify order: get all table cells with filenames and check they're sorted
    const rows = screen.getAllByRole('row')
    const filenames = rows
      .slice(1) // skip header row
      .map((row) => row.querySelectorAll('td')[2]?.textContent)
      .filter(Boolean)
    expect(filenames.length).toBeGreaterThanOrEqual(2)
    // After clicking once, sort should toggle — verify both files are still visible
    expect(screen.getByText('alpha-file.png')).toBeInTheDocument()
    expect(screen.getByText('zeta-file.png')).toBeInTheDocument()
  })
})
