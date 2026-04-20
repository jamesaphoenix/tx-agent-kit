import { Context, Effect, Layer, Option } from 'effect'
import { buildThumbnailPath } from '../domain/assets-domain.js'
import { internalError, notFound, type CoreError } from '../../../errors.js'
import { requireOwnership } from '../../../effect-utils.js'
import {
  MediaAssetStorePort,
  StorageAdapterPort,
  ThumbnailGeneratorPort
} from '../ports/assets-ports.js'

export type AssetThumbnailGenerationResult =
  | { readonly status: 'generated'; readonly thumbnailPath: string }
  | { readonly status: 'skipped'; readonly reason: 'existing' | 'unsupported_type'; readonly thumbnailPath: string | null }

const canGenerateThumbnail = (assetType: string, mimeType: string): boolean =>
  (assetType === 'image' || assetType === 'gif') && mimeType.startsWith('image/')

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class AssetThumbnailService extends Context.Tag('AssetThumbnailService')<
  AssetThumbnailService,
  {
    generateForAsset: (
      input: {
        teamId: string
        assetId: string
      }
    ) => Effect.Effect<
      AssetThumbnailGenerationResult,
      CoreError,
      MediaAssetStorePort | StorageAdapterPort | ThumbnailGeneratorPort
    >
  }
>() {}

export const AssetThumbnailServiceLive = Layer.effect(
  AssetThumbnailService,
  Effect.succeed({
    generateForAsset: (input) =>
      Effect.gen(function* () {
        const store = yield* MediaAssetStorePort
        const storage = yield* StorageAdapterPort
        const generator = yield* ThumbnailGeneratorPort

        const asset = yield* store.getById(input.assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to get asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Asset not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(asset, input.teamId, 'teamId', 'Asset does not belong to this team', {
          assetId: asset.id,
          teamId: input.teamId
        })

        if (asset.thumbnailPath) {
          return {
            status: 'skipped' as const,
            reason: 'existing' as const,
            thumbnailPath: asset.thumbnailPath
          }
        }

        if (!canGenerateThumbnail(asset.assetType, asset.mimeType)) {
          return {
            status: 'skipped' as const,
            reason: 'unsupported_type' as const,
            thumbnailPath: null
          }
        }

        const thumbnailPath = buildThumbnailPath(asset.teamId, asset.id, asset.originalFilename)

        return yield* Effect.gen(function* () {
          const original = yield* storage.getObject(asset.storagePath).pipe(
            Effect.mapError((cause) => internalError('Failed to read source asset for thumbnail', cause))
          )
          const thumbnail = yield* generator.generateImageThumbnail({
            body: original,
            mimeType: asset.mimeType
          }).pipe(
            Effect.mapError((cause) => internalError('Failed to generate asset thumbnail', cause))
          )
          yield* storage.putObject({
            storagePath: thumbnailPath,
            body: thumbnail.body,
            mimeType: thumbnail.mimeType
          }).pipe(
            Effect.mapError((cause) => internalError('Failed to write asset thumbnail', cause))
          )
          yield* store.update({
            id: asset.id,
            thumbnailPath,
            processingError: null
          }).pipe(
            Effect.mapError((cause) => internalError('Failed to update asset thumbnail path', cause)),
            Effect.flatMap(Option.match({
              onNone: () => Effect.fail(internalError('Failed to update asset thumbnail path')),
              onSome: Effect.succeed
            }))
          )
          return {
            status: 'generated' as const,
            thumbnailPath
          }
        }).pipe(
          Effect.catchAll((cause) =>
            store.update({
              id: asset.id,
              processingError: `Thumbnail generation failed: ${errorMessage(cause)}`
            }).pipe(
              Effect.ignore,
              Effect.zipRight(Effect.fail(cause))
            )
          )
        )
      })
  })
)
