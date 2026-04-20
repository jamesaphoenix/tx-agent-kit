import { HttpApiBuilder } from '@effect/platform'
import { Storage } from '@tx-agent-kit/storage'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'
import { requireAuth } from '../utils.js'

export const StorageRouteKind = 'custom' as const

export const StorageLive = HttpApiBuilder.group(TxAgentApi, 'storage', (handlers) =>
  handlers
    .handle('generateUploadUrl', ({ payload }) =>
      Effect.gen(function* () {
        const _principal = yield* requireAuth

        const storage = yield* Storage
        const url = yield* storage.generateUploadUrl(
          payload.key,
          payload.contentType,
          payload.expiresIn
        ).pipe(
          Effect.mapError(mapCoreError)
        )

        return { url }
      })
    )
    .handle('generateDownloadUrl', ({ payload }) =>
      Effect.gen(function* () {
        const _principal = yield* requireAuth

        const storage = yield* Storage
        const url = yield* storage.generateDownloadUrl(
          payload.key,
          payload.expiresIn
        ).pipe(
          Effect.mapError(mapCoreError)
        )

        return { url }
      })
    )
    .handle('deleteObject', ({ payload }) =>
      Effect.gen(function* () {
        const _principal = yield* requireAuth

        const storage = yield* Storage
        yield* storage.deleteObject(payload.key).pipe(
          Effect.mapError(mapCoreError)
        )

        return { deleted: true }
      })
    )
    .handle('listObjects', ({ urlParams }) =>
      Effect.gen(function* () {
        const _principal = yield* requireAuth

        const storage = yield* Storage
        const keys = yield* storage.listObjects(urlParams.prefix).pipe(
          Effect.mapError(mapCoreError)
        )

        return { keys: [...keys] }
      })
    )
    .handle('getObjectMetadata', ({ path }) =>
      Effect.gen(function* () {
        const _principal = yield* requireAuth

        const storage = yield* Storage
        const metadata = yield* storage.getObjectMetadata(path.key).pipe(
          Effect.mapError(mapCoreError)
        )

        return {
          key: metadata.key,
          contentType: metadata.contentType ?? null,
          contentLength: metadata.contentLength ?? null,
          lastModified: metadata.lastModified?.toISOString() ?? null,
          etag: metadata.etag ?? null
        }
      })
    )
)
