import { Context, Effect, Layer, Option } from 'effect'
import { SIGNED_URL_EXPIRY_SECONDS } from '@tx-agent-kit/contracts'
import { internalError, notFound, type CoreError } from '../../../errors.js'
import { requireOwnership } from '../../../effect-utils.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { MediaAssetRecord } from '../domain/assets-domain.js'
import {
  MediaAssetStorePort,
  StorageMeteringPort,
  StorageAdapterPort,
  TeamLookupPort
} from '../ports/assets-ports.js'

export class MediaAssetService extends Context.Tag('MediaAssetService')<
  MediaAssetService,
  {
    getById: (
      teamId: string,
      assetId: string
    ) => Effect.Effect<MediaAssetRecord, CoreError, MediaAssetStorePort>
    list: (
      teamId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<MediaAssetRecord>, CoreError, MediaAssetStorePort>
    search: (
      teamId: string,
      query: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<MediaAssetRecord>, CoreError, MediaAssetStorePort>
    softDelete: (
      teamId: string,
      assetId: string
    ) => Effect.Effect<MediaAssetRecord, CoreError, MediaAssetStorePort | StorageMeteringPort | TeamLookupPort>
    updateMetadata: (input: {
      teamId: string
      assetId: string
      aiTitle?: string | null
      aiDescription?: string | null
      aiTags?: ReadonlyArray<string>
      sharedWithOrg?: boolean
    }) => Effect.Effect<MediaAssetRecord, CoreError, MediaAssetStorePort>
    getSignedUrl: (
      teamId: string,
      assetId: string
    ) => Effect.Effect<string, CoreError, MediaAssetStorePort | StorageAdapterPort>
    getThumbnailSignedUrl: (
      teamId: string,
      assetId: string
    ) => Effect.Effect<string | null, CoreError, MediaAssetStorePort | StorageAdapterPort>
  }
>() {}

export const MediaAssetServiceLive = Layer.effect(
  MediaAssetService,
  Effect.succeed({
    getById: (teamId, assetId) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort
        const asset = yield* store.getById(assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to get asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Asset not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(asset, teamId, 'teamId', 'Asset does not belong to this team', { assetId: asset.id, teamId })
        return asset
      }),

    list: (teamId, params) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort
        return yield* store.list(teamId, params).pipe(
          Effect.mapError((cause) => internalError('Failed to list assets', cause))
        )
      }),

    search: (teamId, query, params) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort
        return yield* store.search(teamId, query, params).pipe(
          Effect.mapError((cause) => internalError('Failed to search assets', cause))
        )
      }),

    softDelete: (teamId, assetId) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort
        const meteringPort = yield* StorageMeteringPort
        const teamLookup = yield* TeamLookupPort

        const asset = yield* store.getById(assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to get asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Asset not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(asset, teamId, 'teamId', 'Asset does not belong to this team', { assetId: asset.id, teamId })

        const deleted = yield* store.softDelete(assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to soft-delete asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Failed to soft-delete asset')),
            onSome: Effect.succeed
          }))
        )

        // Resolve organizationId from team (metering is per-org)
        const maybeOrgId = yield* teamLookup.getOrganizationId(teamId).pipe(
          Effect.mapError((cause) => internalError('Failed to resolve organization for team', cause))
        )
        if (Option.isSome(maybeOrgId)) {
          yield* meteringPort.decrementBytes(maybeOrgId.value, asset.fileSize).pipe(
            Effect.mapError((cause) => internalError('Failed to update storage metering', cause))
          )
        }

        return deleted
      }),

    updateMetadata: (input) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort

        const asset = yield* store.getById(input.assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to get asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Asset not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(asset, input.teamId, 'teamId', 'Asset does not belong to this team', { assetId: asset.id, teamId: input.teamId })

        const updated = yield* store.update({
          id: input.assetId,
          aiTitle: input.aiTitle,
          aiDescription: input.aiDescription,
          aiTags: input.aiTags,
          sharedWithOrg: input.sharedWithOrg
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to update asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Failed to update asset')),
            onSome: Effect.succeed
          }))
        )
        return updated
      }),

    getSignedUrl: (teamId, assetId) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort
        const storageAdapter = yield* StorageAdapterPort

        const asset = yield* store.getById(assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to get asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Asset not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(asset, teamId, 'teamId', 'Asset does not belong to this team', { assetId: asset.id, teamId })

        return yield* storageAdapter.createPresignedReadUrl({
          storagePath: asset.storagePath,
          expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to generate signed URL', cause))
        )
      }),

    getThumbnailSignedUrl: (teamId, assetId) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort
        const storageAdapter = yield* StorageAdapterPort

        const asset = yield* store.getById(assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to get asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Asset not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(asset, teamId, 'teamId', 'Asset does not belong to this team', { assetId: asset.id, teamId })

        if (!asset.thumbnailPath) {
          return null
        }

        return yield* storageAdapter.createPresignedReadUrl({
          storagePath: asset.thumbnailPath,
          expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to generate thumbnail signed URL', cause))
        )
      })
  })
)
