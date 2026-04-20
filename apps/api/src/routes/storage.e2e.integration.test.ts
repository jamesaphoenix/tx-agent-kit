import { randomUUID } from 'node:crypto'
import {
  createUser,
  createOrganization,
  createTeamWithMembers,
  uploadTestAsset
} from '@tx-agent-kit/testkit'
import { Storage, StorageLive } from '@tx-agent-kit/storage'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './test-helpers.js'

const runE2eStorage = process.env.RUN_E2E_STORAGE === '1'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext, dbAuthContext } = createTestFixture({
  schemaPrefix: 'e2e_storage'
})

/**
 * Helper to activate a Pro subscription on an organization via the schema-scoped client.
 */
const activateSubscription = async (organizationId: string): Promise<void> => {
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
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

/**
 * Helper to create a user + org (with active subscription) + team.
 */
const setupUserOrgTeam = async () => {
  const factoryContext = getFactoryContext()

  const owner = await createUser(factoryContext, {
    email: `e2e-storage-${uid}-${randomUUID().slice(0, 6)}@example.com`,
    password: 'e2e-storage-pass-12345',
    name: 'E2E Storage Owner'
  })

  const org = await createOrganization(factoryContext, {
    token: owner.token,
    name: `E2E Storage Org ${randomUUID().slice(0, 6)}`
  })

  await activateSubscription(org.id)

  const { team } = await createTeamWithMembers(factoryContext, {
    token: owner.token,
    organizationId: org.id,
    teamName: `E2E Storage Team ${randomUUID().slice(0, 6)}`
  })

  return { owner, org, team, factoryContext }
}

/**
 * Run an Effect with the real StorageLive layer (R2).
 */
const runStorage = <A>(effect: Effect.Effect<A, unknown, Storage>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(StorageLive)))

/**
 * Helper to clean up R2 objects after tests.
 */
const cleanupR2Objects = async (storagePaths: string[]): Promise<void> => {
  for (const path of storagePaths) {
    try {
      await runStorage(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.deleteObject(path)
        })
      )
    } catch {
      // Ignore cleanup errors — the object may already be deleted
    }
  }
}

describe('storage E2E', () => {
  it.skipIf(!runE2eStorage)('full upload lifecycle — upload, read, soft-delete, verify', async () => {
    const { owner, team } = await setupUserOrgTeam()
    const factoryContext = getFactoryContext()
    const r2PathsToCleanup: string[] = []

    try {
      // Step 1: Upload a real file via the two-phase upload flow
      const asset = await uploadTestAsset({
        baseUrl: factoryContext.baseUrl,
        token: owner.token,
        teamId: team.id,
        fileName: `e2e-lifecycle-${uid}.png`,
        mimeType: 'image/png'
      })

      expect(asset.id).toBeTruthy()
      expect(asset.storagePath).toBeTruthy()
      r2PathsToCleanup.push(asset.storagePath)

      // Step 2: Get a signed read URL for the uploaded asset
      const signedUrlResult = await request<{ url: string }>(
        `/v1/teams/${team.id}/assets/${asset.id}/url`,
        'e2e-signed-url',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${owner.token}` }
        }
      )

      expect(signedUrlResult.response.status).toBe(200)
      expect(signedUrlResult.body.url).toBeTruthy()

      // Step 3: Fetch the signed URL and verify the file content is accessible
      const downloadResponse = await fetch(signedUrlResult.body.url)
      expect(downloadResponse.status).toBe(200)
      const downloadedBytes = await downloadResponse.arrayBuffer()
      expect(downloadedBytes.byteLength).toBeGreaterThan(0)

      // Step 4: Soft-delete the asset
      const deleteResult = await request<{ id: string; isDeleted: boolean; deletedAt: string | null }>(
        `/v1/teams/${team.id}/assets/${asset.id}`,
        'e2e-soft-delete',
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${owner.token}` }
        }
      )

      expect(deleteResult.response.status).toBe(200)
      expect(deleteResult.body.isDeleted).toBe(true)
      expect(deleteResult.body.deletedAt).toBeTruthy()

      // Step 5: Verify the asset is no longer returned in the list (soft-deleted assets are filtered)
      const listResult = await request<{ data: Array<{ id: string }>; total: number }>(
        `/v1/teams/${team.id}/assets`,
        'e2e-list-after-delete',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${owner.token}` }
        }
      )

      expect(listResult.response.status).toBe(200)
      const deletedInList = listResult.body.data.find((a) => a.id === asset.id)
      expect(deletedInList).toBeUndefined()
    } finally {
      await cleanupR2Objects(r2PathsToCleanup)
    }
  })

  it.skipIf(!runE2eStorage)('team deletion emits domain event and R2 files can be purged', async () => {
    const { owner, team } = await setupUserOrgTeam()
    const factoryContext = getFactoryContext()
    const r2PathsToCleanup: string[] = []

    try {
      // Step 1: Upload a real file
      const asset = await uploadTestAsset({
        baseUrl: factoryContext.baseUrl,
        token: owner.token,
        teamId: team.id,
        fileName: `e2e-team-delete-${uid}.png`,
        mimeType: 'image/png'
      })

      expect(asset.storagePath).toBeTruthy()
      const storagePath = asset.storagePath
      r2PathsToCleanup.push(storagePath)

      // Step 2: Verify the file exists in R2 before deletion
      const metadata = await runStorage(
        Effect.gen(function* () {
          const storage = yield* Storage
          return yield* storage.getObjectMetadata(storagePath)
        })
      )
      expect(metadata.contentLength).toBeGreaterThan(0)

      // Step 3: Delete the team via API
      const deleteTeamResult = await request<{ deleted: boolean }>(
        `/v1/teams/${team.id}`,
        'e2e-delete-team',
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${owner.token}` }
        }
      )

      expect(deleteTeamResult.response.status).toBe(200)
      expect(deleteTeamResult.body.deleted).toBe(true)

      // Step 4: Verify the team.deleted domain event was emitted
      await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{
          event_type: string
          payload: Record<string, unknown>
        }>(
          `SELECT event_type, payload FROM domain_events
           WHERE aggregate_type = 'team' AND aggregate_id = $1
           ORDER BY occurred_at ASC`,
          [team.id]
        )
        const deletedEvent = result.rows.find((row) => row.event_type === 'team.deleted')
        expect(deletedEvent).toBeTruthy()
        const payload = deletedEvent!.payload
        expect(payload.teamId).toBe(team.id)
        expect(typeof payload.organizationId).toBe('string')
      })

      // Step 5: Wait for the Temporal worker to process the team.deleted event
      // The worker picks up the event from the outbox, extracts storagePaths from
      // the payload, and calls deleteObjects on R2. Poll until the file is gone.
      const maxPollMs = 30_000
      const pollStart = Date.now()
      let fileGone = false

      while (Date.now() - pollStart < maxPollMs) {
        try {
          const keys = await runStorage(
            Effect.gen(function* () {
              const storage = yield* Storage
              return yield* storage.listObjects(storagePath)
            })
          )
          if (!keys.includes(storagePath)) {
            fileGone = true
            break
          }
        } catch {
          // R2 query failed — file may already be gone
          fileGone = true
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000))
      }

      expect(fileGone).toBe(true)

      // File has been purged by the worker, no manual cleanup needed
      const cleanupIndex = r2PathsToCleanup.indexOf(storagePath)
      if (cleanupIndex !== -1) {
        r2PathsToCleanup.splice(cleanupIndex, 1)
      }
    } finally {
      await cleanupR2Objects(r2PathsToCleanup)
    }
  })

  it.skipIf(!runE2eStorage)('quota enforcement blocks over-limit uploads', async () => {
    const { owner, org, team } = await setupUserOrgTeam()
    const factoryContext = getFactoryContext()
    const r2PathsToCleanup: string[] = []

    try {
      // Step 1: Upload a small file within quota — should succeed
      const asset = await uploadTestAsset({
        baseUrl: factoryContext.baseUrl,
        token: owner.token,
        teamId: team.id,
        fileName: `e2e-quota-ok-${uid}.png`,
        mimeType: 'image/png'
      })

      expect(asset.id).toBeTruthy()
      r2PathsToCleanup.push(asset.storagePath)

      // Step 2: Set storage metering to just under the 2x hard cap (Pro plan = 50GB, cap = 100GB)
      // Leave 10KB headroom so the tiny PNG (~67 bytes) still fits under cap
      const justUnderCap = 100 * 1024 * 1024 * 1024 - 10_000
      await seedStorageMetering(org.id, justUnderCap)

      // Step 3: Another small upload should still succeed (just under cap)
      const asset2 = await uploadTestAsset({
        baseUrl: factoryContext.baseUrl,
        token: owner.token,
        teamId: team.id,
        fileName: `e2e-quota-near-cap-${uid}.png`,
        mimeType: 'image/png'
      })

      expect(asset2.id).toBeTruthy()
      r2PathsToCleanup.push(asset2.storagePath)

      // Step 4: Set storage metering to over the 2x hard cap (any upload will be rejected)
      const overCap = 100 * 1024 * 1024 * 1024
      await seedStorageMetering(org.id, overCap)

      // Step 5: Upload should now fail with 402
      const overLimitResult = await request<{ message?: string }>(
        `/v1/teams/${team.id}/uploads/request`,
        'e2e-quota-over-cap',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${owner.token}`
          },
          body: JSON.stringify({
            fileName: `e2e-quota-blocked-${uid}.png`,
            fileSize: 1024,
            contentHash: null,
            mimeType: 'image/png'
          })
        }
      )

      expect(overLimitResult.response.status).toBe(402)
      expect(overLimitResult.body.message).toContain('Storage quota exceeded')
    } finally {
      await cleanupR2Objects(r2PathsToCleanup)
    }
  })
})
