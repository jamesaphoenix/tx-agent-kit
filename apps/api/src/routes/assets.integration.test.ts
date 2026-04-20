import { randomUUID } from 'node:crypto'
import {
  DECIMILLICENTS_PER_DOLLAR,
  PLAN_HARD_CEILING_BYTES,
  PLAN_STORAGE_LIMIT_BYTES
} from '@tx-agent-kit/contracts'
import {
  createUser,
  createOrganization,
  createTeamWithMembers,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext, dbAuthContext } = createTestFixture({
  schemaPrefix: 'api_assets'
})

/**
 * Helper to set subscription status directly on the organizations table.
 */
const setSubscription = async (
  organizationId: string,
  opts: { isSubscribed: boolean; subscriptionPlan: string | null; subscriptionStatus?: string }
): Promise<void> => {
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations
       SET is_subscribed = $1,
           subscription_plan = $2,
           subscription_status = $3
       WHERE id = $4`,
      [
        opts.isSubscribed,
        opts.subscriptionPlan,
        opts.subscriptionStatus ?? (opts.isSubscribed ? 'active' : 'inactive'),
        organizationId
      ]
    )
  })
}

/**
 * Helper to seed storage metering for an organization.
 */
const seedStorageMetering = async (
  organizationId: string,
  activeBytes: number
): Promise<void> => {
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
    await client.query(
      `INSERT INTO storage_metering (organization_id, active_bytes, active_asset_count, measured_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (organization_id) DO UPDATE
       SET active_bytes = $2`,
      [organizationId, activeBytes]
    )
  })
}

const seedReservedCredits = async (
  organizationId: string,
  reservedCreditsDecimillicents: number
): Promise<void> => {
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET reserved_credits = $1, updated_at = NOW() WHERE id = $2`,
      [reservedCreditsDecimillicents, organizationId]
    )
  })
}

const seedMediaAsset = async (
  teamId: string,
  opts: {
    originalFilename?: string
    fileSize?: number
    mimeType?: string
    assetType?: 'image' | 'video' | 'audio' | 'gif' | 'document'
    storagePath?: string
    thumbnailPath?: string | null
    aiTitle?: string | null
    aiDescription?: string | null
    aiTags?: ReadonlyArray<string>
  } = {}
): Promise<string> => {
  let assetId: string | null = null
  const originalFilename = opts.originalFilename ?? 'existing-hard-cap.png'
  const storagePath = opts.storagePath ?? `assets/${teamId}/${randomUUID()}-${originalFilename}`
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO team_media_assets (
         team_id,
         original_filename,
         file_size,
         mime_type,
         asset_type,
         storage_path,
         thumbnail_path,
         ai_title,
         ai_description,
         ai_tags,
         processing_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed')
       RETURNING id`,
      [
        teamId,
        originalFilename,
        opts.fileSize ?? 1024,
        opts.mimeType ?? 'image/png',
        opts.assetType ?? 'image',
        storagePath,
        opts.thumbnailPath ?? null,
        opts.aiTitle ?? null,
        opts.aiDescription ?? null,
        opts.aiTags ? [...opts.aiTags] : []
      ]
    )
    assetId = result.rows[0]?.id ?? null
  })
  if (assetId === null) {
    throw new Error('Failed to seed media asset')
  }
  return assetId
}

const readStorageMetering = async (
  organizationId: string
): Promise<{
  activeBytes: number
  highWaterMarkBytes: number
  activeAssetCount: number
  softDeletedBytes: number
  softDeletedAssetCount: number
} | null> => {
  let metering: {
    activeBytes: number
    highWaterMarkBytes: number
    activeAssetCount: number
    softDeletedBytes: number
    softDeletedAssetCount: number
  } | null = null
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{
      active_bytes: string
      high_water_mark_bytes: string
      active_asset_count: number
      soft_deleted_bytes: string
      soft_deleted_asset_count: number
    }>(
      `SELECT active_bytes, high_water_mark_bytes, active_asset_count, soft_deleted_bytes, soft_deleted_asset_count
       FROM storage_metering
       WHERE organization_id = $1`,
      [organizationId]
    )
    const row = result.rows[0]
    metering = row
      ? {
          activeBytes: Number(row.active_bytes),
          highWaterMarkBytes: Number(row.high_water_mark_bytes),
          activeAssetCount: row.active_asset_count,
          softDeletedBytes: Number(row.soft_deleted_bytes),
          softDeletedAssetCount: row.soft_deleted_asset_count
        }
      : null
  })
  return metering
}

/**
 * Helper to create a user + org + team ready for upload tests.
 */
const setupUserOrgTeam = async () => {
  const factoryContext = getFactoryContext()

  const owner = await createUser(factoryContext, {
    email: `assets-upload-owner-${uid}-${randomUUID().slice(0, 6)}@example.com`,
    password: 'assets-upload-pass-12345',
    name: 'Assets Upload Owner'
  })

  const org = await createOrganization(factoryContext, {
    token: owner.token,
    name: `Assets Upload Org ${randomUUID().slice(0, 6)}`
  })

  const { team } = await createTeamWithMembers(factoryContext, {
    token: owner.token,
    organizationId: org.id,
    teamName: `Upload Team ${randomUUID().slice(0, 6)}`
  })

  return { owner, org, team }
}

const makeUploadRequest = (teamId: string, token: string, caseName: string) =>
  request<{ uploadId?: string; message?: string }>(
    `/v1/teams/${teamId}/uploads/request`,
    caseName,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        fileName: 'test-upload.png',
        fileSize: 1024,
        contentHash: null,
        mimeType: 'image/png'
      })
    }
  )

const putUploadContent = async (
  teamId: string,
  uploadId: string,
  token: string,
  caseName: string,
  body: Uint8Array,
  contentType: string
) => {
  const response = await fetch(`${dbAuthContext.baseUrl}/v1/teams/${teamId}/uploads/${uploadId}/content`, {
    method: 'PUT',
    headers: dbAuthContext.testContext.headersForCase(caseName, {
      authorization: `Bearer ${token}`,
      'content-type': contentType
    }),
    body: Buffer.from(body)
  })

  const parsed = await response.json() as { uploaded?: boolean; message?: string }
  return { response, body: parsed }
}

describe('assets upload quota enforcement', () => {
  it('rejects upload when organization has no subscription (403)', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    // Ensure no subscription
    await setSubscription(org.id, {
      isSubscribed: false,
      subscriptionPlan: null
    })

    const result = await makeUploadRequest(team.id, owner.token, 'upload-no-sub')

    expect(result.response.status).toBe(403)
    expect(result.body.message).toContain('Subscription required')
  })

  it('allows upload when within plan storage limits (201) [INV-REQ-ASSETS-001] [INV-REQ-ASSETS-002] [INV-REQ-ASSETS-003] [INV-REQ-ASSETS-004]', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    // Set up active subscription with pro plan (100 GB included)
    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    // No metering record = 0 bytes used, well within limits
    const result = await makeUploadRequest(team.id, owner.token, 'upload-within-limit')

    expect(result.response.status).toBe(201)
    expect(result.body.uploadId).toBeTruthy()
  })

  it('allows upload when in overage zone (between included and 2x hard cap) (201)', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    // Set up active subscription with pro plan (100 GB included, 200 GB hard cap)
    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    // Seed storage metering to be in the overage zone — half-way between
    // the Pro plan allocation and the 2× hard ceiling. With credits on the
    // org, the projected overage should pass the upload-time guard.
    const overageBytes =
      PLAN_STORAGE_LIMIT_BYTES.pro
      + (PLAN_HARD_CEILING_BYTES.pro - PLAN_STORAGE_LIMIT_BYTES.pro) / 2
    await seedStorageMetering(org.id, overageBytes)
    await seedOrgCredits(getFactoryContext(), org.id, 10 * DECIMILLICENTS_PER_DOLLAR)

    const result = await makeUploadRequest(team.id, owner.token, 'upload-overage-zone')

    expect(result.response.status).toBe(201)
    expect(result.body.uploadId).toBeTruthy()
  })

  it('rejects overage upload when prepaid credits cannot cover projected overage (402) [INV-AST-014]', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    await seedStorageMetering(org.id, PLAN_STORAGE_LIMIT_BYTES.pro - 512)

    const result = await makeUploadRequest(team.id, owner.token, 'upload-overage-insufficient-credits')

    expect(result.response.status).toBe(402)
    expect(result.body.message).toContain('Storage quota exceeded')
  })

  it('rejects overage upload when credits are reserved and unavailable (402) [INV-AST-014]', async () => {
    const { owner, org, team } = await setupUserOrgTeam()
    const credits = 10 * DECIMILLICENTS_PER_DOLLAR

    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })
    await seedStorageMetering(org.id, PLAN_STORAGE_LIMIT_BYTES.pro - 512)
    await seedOrgCredits(getFactoryContext(), org.id, credits)
    await seedReservedCredits(org.id, credits)

    const result = await makeUploadRequest(team.id, owner.token, 'upload-overage-reserved-credits')

    expect(result.response.status).toBe(402)
    expect(result.body.message).toContain('Storage quota exceeded')
  })

  it('rejects upload when over 2x hard cap (402) [INV-AST-012]', async () => {
    const { owner, org, team } = await setupUserOrgTeam()
    const existingAssetId = await seedMediaAsset(team.id)

    // Set up active subscription with pro plan (100 GB included, 200 GB hard cap)
    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    // Seed storage metering right at the hard cap — any further upload
    // must be rejected regardless of credit balance.
    await seedStorageMetering(org.id, PLAN_HARD_CEILING_BYTES.pro)

    const result = await makeUploadRequest(team.id, owner.token, 'upload-over-hard-cap')

    expect(result.response.status).toBe(402)
    expect(result.body.message).toContain('Storage quota exceeded')

    const signedUrlResult = await request<{ url?: string }>(
      `/v1/teams/${team.id}/assets/${existingAssetId}/url`,
      'upload-over-hard-cap-existing-read',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(signedUrlResult.response.status).toBe(200)
    expect(signedUrlResult.body.url).toBeTruthy()
  })

  it('returns signed thumbnail URLs only when an asset has a generated thumbnail', async () => {
    const { owner, team } = await setupUserOrgTeam()
    const withThumbnailId = await seedMediaAsset(team.id, {
      originalFilename: 'thumb-ready.png',
      storagePath: `assets/${team.id}/thumb-ready.png`,
      thumbnailPath: `assets/${team.id}/thumb-ready_thumb.webp`
    })
    const withoutThumbnailId = await seedMediaAsset(team.id, {
      originalFilename: 'thumb-pending.png',
      storagePath: `assets/${team.id}/thumb-pending.png`
    })

    const readyResult = await request<{ url: string | null }>(
      `/v1/teams/${team.id}/assets/${withThumbnailId}/thumbnail-url`,
      'asset-thumbnail-url-ready',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(readyResult.response.status).toBe(200)
    expect(readyResult.body.url).toContain('thumb-ready_thumb.webp')

    const pendingResult = await request<{ url: string | null }>(
      `/v1/teams/${team.id}/assets/${withoutThumbnailId}/thumbnail-url`,
      'asset-thumbnail-url-pending',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(pendingResult.response.status).toBe(200)
    expect(pendingResult.body.url).toBeNull()
  })

  it('uploads content through the API upload endpoint and confirms the asset [INV-REQ-ASSETS-005] [INV-REQ-ASSETS-006] [INV-AST-004] [INV-AST-010] [INV-AST-011]', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    const body = new TextEncoder().encode('hello upload proxy')
    const requestResult = await request<{ uploadId: string }>(
      `/v1/teams/${team.id}/uploads/request`,
      'upload-content-request',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          fileName: 'proxy-upload.txt',
          fileSize: body.byteLength,
          contentHash: null,
          mimeType: 'text/plain'
        })
      }
    )

    expect(requestResult.response.status).toBe(201)
    expect(requestResult.body.uploadId).toBeTruthy()

    const uploadResult = await putUploadContent(
      team.id,
      requestResult.body.uploadId,
      owner.token,
      'upload-content-put',
      body,
      'text/plain'
    )

    expect(uploadResult.response.status).toBe(200)
    expect(uploadResult.body.uploaded).toBe(true)

    const confirmResult = await request<{
      id: string
      originalFilename: string
      fileSize: number
      processingStatus: string
    }>(
      `/v1/teams/${team.id}/uploads/${requestResult.body.uploadId}/confirm`,
      'upload-content-confirm',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(confirmResult.response.status).toBe(200)
    expect(confirmResult.body.originalFilename).toBe('proxy-upload.txt')
    expect(confirmResult.body.fileSize).toBe(body.byteLength)
    expect(confirmResult.body.processingStatus).toBe('completed')

    const afterConfirm = await readStorageMetering(org.id)
    expect(afterConfirm).not.toBeNull()
    expect(afterConfirm?.activeBytes).toBe(body.byteLength)
    expect(afterConfirm?.highWaterMarkBytes).toBe(body.byteLength)
    expect(afterConfirm?.activeAssetCount).toBe(1)

    const deleteResult = await request<{ isDeleted: boolean }>(
      `/v1/teams/${team.id}/assets/${confirmResult.body.id}`,
      'upload-content-delete',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(deleteResult.response.status).toBe(200)
    expect(deleteResult.body.isDeleted).toBe(true)

    const afterDelete = await readStorageMetering(org.id)
    expect(afterDelete?.activeBytes).toBe(0)
    expect(afterDelete?.highWaterMarkBytes).toBe(body.byteLength)
    expect(afterDelete?.softDeletedBytes).toBe(body.byteLength)
    expect(afterDelete?.softDeletedAssetCount).toBe(1)
  })

  it('emits an async thumbnail request event when confirming image uploads', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    const body = new Uint8Array([1, 2, 3, 4])
    const requestResult = await request<{ uploadId: string }>(
      `/v1/teams/${team.id}/uploads/request`,
      'thumbnail-event-request',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          fileName: 'thumbnail-event.png',
          fileSize: body.byteLength,
          contentHash: null,
          mimeType: 'image/png'
        })
      }
    )

    expect(requestResult.response.status).toBe(201)

    const uploadResult = await putUploadContent(
      team.id,
      requestResult.body.uploadId,
      owner.token,
      'thumbnail-event-put',
      body,
      'image/png'
    )
    expect(uploadResult.response.status).toBe(200)

    const confirmResult = await request<{ id: string; processingStatus: string }>(
      `/v1/teams/${team.id}/uploads/${requestResult.body.uploadId}/confirm`,
      'thumbnail-event-confirm',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(confirmResult.response.status).toBe(200)
    expect(confirmResult.body.processingStatus).toBe('completed')

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        event_type: string
        aggregate_type: string
        aggregate_id: string
        payload: { assetId?: string; teamId?: string }
      }>(
        `SELECT event_type, aggregate_type, aggregate_id, payload
           FROM domain_events
          WHERE aggregate_id = $1
            AND event_type = 'assets.thumbnail_requested'`,
        [confirmResult.body.id]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        event_type: 'assets.thumbnail_requested',
        aggregate_type: 'assets',
        aggregate_id: confirmResult.body.id
      })
      expect(result.rows[0]?.payload).toMatchObject({
        assetId: confirmResult.body.id,
        teamId: team.id
      })
    })
  })

  it('rejects API upload bodies whose byte length differs from the pending upload [INV-AST-006]', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    const declaredBody = new TextEncoder().encode('declared')
    const requestResult = await request<{ uploadId: string }>(
      `/v1/teams/${team.id}/uploads/request`,
      'upload-content-size-mismatch-request',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          fileName: 'size-mismatch.txt',
          fileSize: declaredBody.byteLength,
          contentHash: null,
          mimeType: 'text/plain'
        })
      }
    )

    expect(requestResult.response.status).toBe(201)

    const mismatchedBody = new TextEncoder().encode('declared-plus-extra')
    const uploadResult = await putUploadContent(
      team.id,
      requestResult.body.uploadId,
      owner.token,
      'upload-content-size-mismatch-put',
      mismatchedBody,
      'text/plain'
    )

    expect(uploadResult.response.status).toBe(400)
    expect(uploadResult.body.message).toContain('content length does not match')
    expect(await readStorageMetering(org.id)).toBeNull()
  })

  it('allows API upload bodies larger than the default 1 MB limit', async () => {
    const { owner, org, team } = await setupUserOrgTeam()

    await setSubscription(org.id, {
      isSubscribed: true,
      subscriptionPlan: 'pro'
    })

    const body = new Uint8Array(1024 * 1024 + 256)
    body.fill(97)
    const requestResult = await request<{ uploadId: string }>(
      `/v1/teams/${team.id}/uploads/request`,
      'upload-content-large-request',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          fileName: 'large-proxy-upload.txt',
          fileSize: body.byteLength,
          contentHash: null,
          mimeType: 'text/plain'
        })
      }
    )

    expect(requestResult.response.status).toBe(201)

    const uploadResult = await putUploadContent(
      team.id,
      requestResult.body.uploadId,
      owner.token,
      'upload-content-large-put',
      body,
      'text/plain'
    )

    expect(uploadResult.response.status).toBe(200)
    expect(uploadResult.body.uploaded).toBe(true)
  })

  it('searches assets server-side by filename and AI metadata while preserving team isolation [INV-AST-016]', async () => {
    const { owner, team } = await setupUserOrgTeam()
    const other = await setupUserOrgTeam()

    await seedMediaAsset(team.id, {
      originalFilename: 'sunrise-campaign.png',
      aiTitle: 'Morning Launch Creative',
      aiDescription: 'Warm sunrise visuals for launch week',
      aiTags: ['launch', 'sunrise']
    })
    await seedMediaAsset(team.id, {
      originalFilename: 'winter-offer.png',
      aiTitle: 'Snow Discount',
      aiDescription: 'Cold weather campaign asset',
      aiTags: ['winter']
    })
    await seedMediaAsset(team.id, {
      originalFilename: 'tagged-only.png',
      aiTitle: null,
      aiDescription: null,
      aiTags: ['sunrise']
    })
    await seedMediaAsset(other.team.id, {
      originalFilename: 'sunrise-other-team.png',
      aiTitle: 'Sunrise in another workspace',
      aiDescription: 'Must not leak across team boundaries',
      aiTags: ['sunrise']
    })

    const result = await request<{
      data: ReadonlyArray<{ originalFilename: string }>
      total: number
    }>(
      `/v1/teams/${team.id}/assets/search?query=sunrise`,
      'assets-search-keyword',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.total).toBe(2)
    expect(result.body.data.map((asset) => asset.originalFilename).sort()).toEqual([
      'sunrise-campaign.png',
      'tagged-only.png'
    ])
  })

  it('filters listed assets by asset type before pagination', async () => {
    const { owner, team } = await setupUserOrgTeam()

    await seedMediaAsset(team.id, {
      originalFilename: 'asset-filter-image.png',
      assetType: 'image',
      mimeType: 'image/png'
    })
    await seedMediaAsset(team.id, {
      originalFilename: 'asset-filter-video.mp4',
      assetType: 'video',
      mimeType: 'video/mp4'
    })

    const result = await request<{
      data: ReadonlyArray<{ originalFilename: string; assetType: string }>
      total: number
    }>(
      `/v1/teams/${team.id}/assets?filter[assetType]=image`,
      'assets-list-filter-asset-type',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.total).toBe(1)
    expect(result.body.data).toEqual([
      expect.objectContaining({
        originalFilename: 'asset-filter-image.png',
        assetType: 'image'
      })
    ])
  })

  it('rejects semantic asset search until embeddings are available [INV-AST-016]', async () => {
    const { owner, team } = await setupUserOrgTeam()

    const result = await request<{ message: string }>(
      `/v1/teams/${team.id}/assets/search?query=sunrise&semantic=true`,
      'assets-search-semantic-unsupported',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(result.response.status).toBe(400)
    expect(result.body.message).toContain('Semantic asset search is not available')
  })

  it('treats SQL wildcard characters as literal asset search text [INV-AST-016]', async () => {
    const { owner, team } = await setupUserOrgTeam()

    await seedMediaAsset(team.id, {
      originalFilename: 'literal-percent%.png',
      storagePath: `assets/${team.id}/literal-percent.png`
    })
    await seedMediaAsset(team.id, {
      originalFilename: 'plain-photo.png',
      storagePath: `assets/${team.id}/plain-photo.png`
    })

    const result = await request<{
      data: ReadonlyArray<{ originalFilename: string }>
      total: number
    }>(
      `/v1/teams/${team.id}/assets/search?query=%25`,
      'assets-search-wildcard-literal',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.total).toBe(1)
    expect(result.body.data.map((asset) => asset.originalFilename)).toEqual([
      'literal-percent%.png'
    ])
  })

  it('persists media collections and collection asset membership [INV-AST-017]', async () => {
    const { owner, team } = await setupUserOrgTeam()
    const assetId = await seedMediaAsset(team.id, {
      originalFilename: 'collection-campaign.png'
    })

    const createResult = await request<{
      id: string
      name: string
      description: string | null
    }>(
      `/v1/teams/${team.id}/collections`,
      'assets-collection-create',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'Launch Assets',
          description: 'Assets for the launch campaign'
        })
      }
    )

    expect(createResult.response.status).toBe(201)
    expect(createResult.body.name).toBe('Launch Assets')
    expect(createResult.body.description).toBe('Assets for the launch campaign')

    const collectionId = createResult.body.id

    const listResult = await request<{
      data: ReadonlyArray<{ id: string; name: string }>
      total: number
    }>(
      `/v1/teams/${team.id}/collections`,
      'assets-collection-list',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(listResult.response.status).toBe(200)
    expect(listResult.body.total).toBe(1)
    expect(listResult.body.data[0]).toMatchObject({
      id: collectionId,
      name: 'Launch Assets'
    })

    const updateResult = await request<{ id: string; name: string; description: string | null }>(
      `/v1/teams/${team.id}/collections/${collectionId}`,
      'assets-collection-update',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'Updated Launch Assets',
          description: null
        })
      }
    )

    expect(updateResult.response.status).toBe(200)
    expect(updateResult.body).toMatchObject({
      id: collectionId,
      name: 'Updated Launch Assets',
      description: null
    })

    const addAssetResult = await request<{ deleted: boolean }>(
      `/v1/teams/${team.id}/collections/${collectionId}/assets`,
      'assets-collection-add-asset',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({ assetId })
      }
    )

    expect(addAssetResult.response.status).toBe(201)
    expect(addAssetResult.body.deleted).toBe(true)

    const listAssetsResult = await request<{
      data: ReadonlyArray<{ id: string; originalFilename: string }>
      total: number
    }>(
      `/v1/teams/${team.id}/collections/${collectionId}/assets`,
      'assets-collection-list-assets',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(listAssetsResult.response.status).toBe(200)
    expect(listAssetsResult.body.total).toBe(1)
    expect(listAssetsResult.body.data[0]).toMatchObject({
      id: assetId,
      originalFilename: 'collection-campaign.png'
    })

    const removeAssetResult = await request<{ deleted: boolean }>(
      `/v1/teams/${team.id}/collections/${collectionId}/assets/${assetId}`,
      'assets-collection-remove-asset',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removeAssetResult.response.status).toBe(200)
    expect(removeAssetResult.body.deleted).toBe(true)

    const listAssetsAfterRemove = await request<{ data: ReadonlyArray<unknown>; total: number }>(
      `/v1/teams/${team.id}/collections/${collectionId}/assets`,
      'assets-collection-list-assets-after-remove',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(listAssetsAfterRemove.response.status).toBe(200)
    expect(listAssetsAfterRemove.body.total).toBe(0)
    expect(listAssetsAfterRemove.body.data).toEqual([])

    const removeCollectionResult = await request<{ deleted: boolean }>(
      `/v1/teams/${team.id}/collections/${collectionId}`,
      'assets-collection-remove',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removeCollectionResult.response.status).toBe(200)
    expect(removeCollectionResult.body.deleted).toBe(true)
  })

  it('rejects adding an asset from another team to a collection [INV-AST-017]', async () => {
    const { owner, team } = await setupUserOrgTeam()
    const other = await setupUserOrgTeam()
    const otherAssetId = await seedMediaAsset(other.team.id, {
      originalFilename: 'foreign-team.png'
    })

    const createResult = await request<{ id: string }>(
      `/v1/teams/${team.id}/collections`,
      'assets-collection-cross-team-create',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'Safe Collection',
          description: null
        })
      }
    )
    expect(createResult.response.status).toBe(201)

    const addResult = await request<{ message: string }>(
      `/v1/teams/${team.id}/collections/${createResult.body.id}/assets`,
      'assets-collection-cross-team-add',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({ assetId: otherAssetId })
      }
    )

    expect(addResult.response.status).toBe(404)
    expect(addResult.body.message).toContain('Asset not found')
  })
})
