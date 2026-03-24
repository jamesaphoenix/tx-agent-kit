import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization } from '@tx-agent-kit/core'
import { Storage } from '@tx-agent-kit/storage'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError, BadRequest } from '../api.js'

export const StorageRouteKind = 'custom' as const

export const StorageLive = HttpApiBuilder.group(TxAgentApi, 'storage', (handlers) =>
  handlers
    .handle('generateUploadUrl', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )

        const storage = yield* Storage
        const url = yield* storage.generateUploadUrl(
          payload.key,
          payload.contentType,
          payload.expiresIn
        ).pipe(
          Effect.mapError((e) => new BadRequest({ message: e.message }))
        )

        return { url }
      })
    )
    .handle('generateDownloadUrl', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )

        const storage = yield* Storage
        const url = yield* storage.generateDownloadUrl(
          payload.key,
          payload.expiresIn
        ).pipe(
          Effect.mapError((e) => new BadRequest({ message: e.message }))
        )

        return { url }
      })
    )
    .handle('deleteObject', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )

        const storage = yield* Storage
        yield* storage.deleteObject(payload.key).pipe(
          Effect.mapError((e) => new BadRequest({ message: e.message }))
        )

        return { deleted: true }
      })
    )
    .handle('listObjects', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )

        const storage = yield* Storage
        const keys = yield* storage.listObjects(urlParams.prefix).pipe(
          Effect.mapError((e) => new BadRequest({ message: e.message }))
        )

        return { keys: [...keys] }
      })
    )
    .handle('getObjectMetadata', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )

        const storage = yield* Storage
        const metadata = yield* storage.getObjectMetadata(path.key).pipe(
          Effect.mapError((e) => new BadRequest({ message: e.message }))
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
