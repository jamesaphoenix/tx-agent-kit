import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import {
  CollectionService,
  MediaAssetService,
  UploadService
} from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { requireTeamPermission } from '../auth-helpers.js'
import { toApiCollection, toApiMediaAsset } from '../mappers/asset-mapper.js'
import { parseListQuery } from './list-query.js'

export const AssetsRouteKind = 'crud' as const

export const AssetsLive = HttpApiBuilder.group(TxAgentApi, 'assets', (handlers) =>
  handlers
    // --- Uploads ---
    .handle('requestUpload', ({ path, payload }) =>
      Effect.gen(function* () {
        const { principal } = yield* requireTeamPermission(path.teamId, 'upload_assets')
        const service = yield* UploadService
        return yield* service.requestUpload({
          teamId: path.teamId,
          userId: principal.userId,
          fileName: payload.fileName,
          fileSize: payload.fileSize,
          contentHash: payload.contentHash,
          mimeType: payload.mimeType
        }).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('uploadContent', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'upload_assets')
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = yield* request.arrayBuffer.pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
          Effect.mapError((cause) => new BadRequest({
            message: `Failed to read upload body: ${cause instanceof Error ? cause.message : String(cause)}`
          }))
        )
        const service = yield* UploadService
        return yield* service.uploadContent(
          path.teamId,
          path.uploadId,
          body,
          request.headers['content-type'] ?? 'application/octet-stream'
        ).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('confirmUpload', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'upload_assets')
        const service = yield* UploadService
        const asset = yield* service.confirmUpload(path.teamId, path.uploadId).pipe(Effect.mapError(mapCoreError))
        return toApiMediaAsset(asset)
      })
    )
    // --- Media Assets ---
    .handle('listAssets', ({ path, urlParams }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* MediaAssetService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'originalFilename', 'fileSize'],
          allowedFilterKeys: ['assetType']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.list(path.teamId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiMediaAsset),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getAsset', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* MediaAssetService
        const asset = yield* service.getById(path.teamId, path.assetId).pipe(Effect.mapError(mapCoreError))
        return toApiMediaAsset(asset)
      })
    )
    .handle('updateAssetMetadata', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* MediaAssetService
        const asset = yield* service.updateMetadata({
          teamId: path.teamId,
          assetId: path.assetId,
          aiTitle: payload.aiTitle,
          aiDescription: payload.aiDescription,
          aiTags: payload.aiTags,
          sharedWithOrg: payload.sharedWithOrg
        }).pipe(Effect.mapError(mapCoreError))
        return toApiMediaAsset(asset)
      })
    )
    .handle('softDeleteAsset', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'delete_assets')
        const service = yield* MediaAssetService
        const asset = yield* service.softDelete(path.teamId, path.assetId).pipe(Effect.mapError(mapCoreError))
        return toApiMediaAsset(asset)
      })
    )
    .handle('getAssetSignedUrl', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* MediaAssetService
        const url = yield* service.getSignedUrl(path.teamId, path.assetId).pipe(Effect.mapError(mapCoreError))
        return { url }
      })
    )
    .handle('getAssetThumbnailSignedUrl', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* MediaAssetService
        const url = yield* service.getThumbnailSignedUrl(path.teamId, path.assetId).pipe(Effect.mapError(mapCoreError))
        return { url }
      })
    )
    .handle('searchAssets', ({ path, urlParams }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* MediaAssetService
        const query = urlParams.query.trim()

        if (!query) {
          return yield* Effect.fail(new BadRequest({ message: 'Search query is required' }))
        }

        if (urlParams.semantic && urlParams.semantic !== 'false') {
          return yield* Effect.fail(new BadRequest({
            message: 'Semantic asset search is not available until embeddings are generated.'
          }))
        }

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt'],
          allowedFilterKeys: ['assetType']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.search(path.teamId, query, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiMediaAsset),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    // --- Collections ---
    .handle('listCollections', ({ path, urlParams }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* CollectionService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'name'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.list(path.teamId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiCollection),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('createCollection', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* CollectionService
        const collection = yield* service.create({
          teamId: path.teamId,
          name: payload.name,
          description: payload.description ?? null
        }).pipe(Effect.mapError(mapCoreError))
        return toApiCollection(collection)
      })
    )
    .handle('updateCollection', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* CollectionService
        const collection = yield* service.update({
          teamId: path.teamId,
          collectionId: path.collectionId,
          name: payload.name,
          description: payload.description
        }).pipe(Effect.mapError(mapCoreError))
        return toApiCollection(collection)
      })
    )
    .handle('removeCollection', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* CollectionService
        return yield* service.remove(path.teamId, path.collectionId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('listCollectionAssets', ({ path, urlParams }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* CollectionService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'originalFilename', 'fileSize'],
          allowedFilterKeys: ['assetType']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listAssets(
          path.teamId,
          path.collectionId,
          parsed.value
        ).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiMediaAsset),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('addAssetToCollection', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* CollectionService
        return yield* service.addAsset(
          path.teamId,
          path.collectionId,
          payload.assetId
        ).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('removeAssetFromCollection', ({ path }) =>
      Effect.gen(function* () {
        yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* CollectionService
        return yield* service.removeAsset(
          path.teamId,
          path.collectionId,
          path.assetId
        ).pipe(Effect.mapError(mapCoreError))
      })
    )
)
