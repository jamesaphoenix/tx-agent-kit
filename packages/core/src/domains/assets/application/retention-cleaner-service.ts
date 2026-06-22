import { Context, Effect, Layer } from 'effect'
import { RETENTION_CLEANER_BATCH_SIZE, PURGE_BATCH_SIZE } from '@tx-agent-kit/contracts'
import { internalError, type CoreError } from '../../../errors.js'
import {
  MediaAssetStorePort,
  PendingUploadStorePort,
  StorageAdapterPort
} from '../ports/assets-ports.js'

export class RetentionCleanerService extends Context.Tag('RetentionCleanerService')<
  RetentionCleanerService,
  {
    cleanExpiredUploads: () => Effect.Effect<
      number,
      CoreError,
      PendingUploadStorePort | StorageAdapterPort
    >
    cleanRetainedAssets: (
      retentionHours: number
    ) => Effect.Effect<
      number,
      CoreError,
      MediaAssetStorePort | StorageAdapterPort
    >
    purgeOrganization: (
      organizationId: string
    ) => Effect.Effect<
      number,
      CoreError,
      MediaAssetStorePort | StorageAdapterPort
    >
    purgeTeam: (
      teamId: string
    ) => Effect.Effect<
      number,
      CoreError,
      MediaAssetStorePort | StorageAdapterPort
    >
  }
>() {}

export const RetentionCleanerServiceLive = Layer.effect(
  RetentionCleanerService,
  Effect.succeed({
    cleanExpiredUploads: () =>
      Effect.gen(function* () {
        const uploadStore = yield* PendingUploadStorePort
        const storageAdapter = yield* StorageAdapterPort

        // @spec INV-AST-001
        const expired = yield* uploadStore.listExpired(new Date(), RETENTION_CLEANER_BATCH_SIZE).pipe(
          Effect.mapError((cause) => internalError('Failed to list expired uploads', cause))
        )

        yield* Effect.forEach(expired, (upload) =>
          Effect.gen(function* () {
            yield* storageAdapter.deleteObject(upload.storagePath).pipe(
              Effect.mapError((cause) => internalError('Failed to delete orphaned R2 object', cause))
            )
            yield* uploadStore.markExpired(upload.id).pipe(
              Effect.mapError((cause) => internalError('Failed to mark upload expired', cause))
            )
          }),
          { concurrency: 1 }
        )

        return expired.length
      }),

    cleanRetainedAssets: (retentionHours) =>
      Effect.gen(function* () {
        const assetStore = yield* MediaAssetStorePort
        const storageAdapter = yield* StorageAdapterPort

        const olderThan = new Date(Date.now() - retentionHours * 60 * 60 * 1000)

        // @spec INV-AST-003
        const candidates = yield* assetStore.listSoftDeletedForRetention({
          olderThan,
          limit: RETENTION_CLEANER_BATCH_SIZE
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to list retention candidates', cause))
        )

        // @spec INV-AST-008
        const eligible = candidates.filter((asset) => !asset.hardDeletedAt)

        yield* Effect.forEach(eligible, (asset) =>
          Effect.gen(function* () {
            yield* storageAdapter.deleteObject(asset.storagePath).pipe(
              Effect.mapError((cause) => internalError('Failed to delete R2 object', cause))
            )

            if (asset.thumbnailPath) {
              yield* storageAdapter.deleteObject(asset.thumbnailPath).pipe(
                Effect.mapError((cause) => internalError('Failed to delete thumbnail', cause))
              )
            }

            yield* assetStore.markHardDeleted(asset.id).pipe(
              Effect.mapError((cause) => internalError('Failed to mark hard-deleted', cause))
            )
          }),
          { concurrency: 1 }
        )

        return eligible.length
      }),

    purgeOrganization: (organizationId) =>
      Effect.gen(function* () {
        const assetStore = yield* MediaAssetStorePort
        const storageAdapter = yield* StorageAdapterPort

        let totalPurged = 0
        let hasMore = true

        // Paginate through all assets to handle orgs with >10k assets (GDPR completeness)
        while (hasMore) {
          const batch = yield* assetStore.listByOrganizationIncludingDeleted(organizationId, {
            limit: PURGE_BATCH_SIZE,
            sortBy: 'createdAt',
            sortOrder: 'asc',
            filter: {}
          }).pipe(
            Effect.mapError((cause) => internalError('Failed to list org assets for purge', cause))
          )

          if (batch.data.length === 0) {
            break
          }

          const storagePaths = batch.data
            .filter((a) => !a.hardDeletedAt)
            .flatMap((a) => [a.storagePath, ...(a.thumbnailPath ? [a.thumbnailPath] : [])])

          if (storagePaths.length > 0) {
            yield* storageAdapter.deleteObjects(storagePaths).pipe(
              Effect.mapError((cause) => internalError('Failed to batch delete R2 objects', cause))
            )
          }

          yield* Effect.forEach(batch.data, (asset) =>
            assetStore.hardDelete(asset.id).pipe(
              Effect.mapError((cause) => internalError('Failed to hard-delete asset', cause))
            ),
            { concurrency: 1 }
          )

          totalPurged += batch.data.length
          hasMore = batch.data.length === PURGE_BATCH_SIZE
        }

        return totalPurged
      }),

    purgeTeam: (teamId) =>
      Effect.gen(function* () {
        const assetStore = yield* MediaAssetStorePort
        const storageAdapter = yield* StorageAdapterPort

        let totalPurged = 0
        let hasMore = true

        // Paginate through all team assets to handle teams with many assets
        while (hasMore) {
          const batch = yield* assetStore.list(teamId, {
            limit: PURGE_BATCH_SIZE,
            sortBy: 'createdAt',
            sortOrder: 'asc',
            filter: {}
          }).pipe(
            Effect.mapError((cause) => internalError('Failed to list team assets for purge', cause))
          )

          if (batch.data.length === 0) {
            break
          }

          const storagePaths = batch.data
            .filter((a) => !a.hardDeletedAt)
            .flatMap((a) => [a.storagePath, ...(a.thumbnailPath ? [a.thumbnailPath] : [])])

          if (storagePaths.length > 0) {
            yield* storageAdapter.deleteObjects(storagePaths).pipe(
              Effect.mapError((cause) => internalError('Failed to batch delete R2 objects', cause))
            )
          }

          yield* Effect.forEach(batch.data, (asset) =>
            assetStore.hardDelete(asset.id).pipe(
              Effect.mapError((cause) => internalError('Failed to hard-delete asset', cause))
            ),
            { concurrency: 1 }
          )

          totalPurged += batch.data.length
          hasMore = batch.data.length === PURGE_BATCH_SIZE
        }

        return totalPurged
      })
  })
)
