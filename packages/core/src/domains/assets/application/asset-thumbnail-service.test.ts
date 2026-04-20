import { describe, expect, it, vi } from 'vitest'
import { Effect, Layer, Option } from 'effect'
import type { MediaAssetRecord } from '../domain/assets-domain.js'
import { buildThumbnailPath } from '../domain/assets-domain.js'
import {
  MediaAssetStorePort,
  StorageAdapterPort,
  ThumbnailGeneratorPort
} from '../ports/assets-ports.js'
import { AssetThumbnailService, AssetThumbnailServiceLive } from './asset-thumbnail-service.js'

const runEffectPromise = Effect.runPromise

const fixedDate = /* @__PURE__ */ (() => {
  const D = Date
  return new D('2026-04-17T00:00:00.000Z')
})()

const makeAsset = (overrides: Partial<MediaAssetRecord> = {}): MediaAssetRecord => ({
  id: '00000000-0000-0000-0000-000000000001',
  teamId: '00000000-0000-0000-0000-000000000002',
  originalFilename: 'photo.jpg',
  fileSize: 1024,
  mimeType: 'image/jpeg',
  assetType: 'image',
  assetCategory: 'user_upload',
  assetTypeData: null,
  storagePath: 'team/source_photo.jpg',
  thumbnailPath: null,
  aiTitle: null,
  aiDescription: null,
  aiTags: [],
  contentCategory: null,
  emotion: null,
  purpose: [],
  contentHash: null,
  processingStatus: 'completed',
  processingError: null,
  embeddingGeneratedAt: null,
  embeddingModel: null,
  isDeleted: false,
  deletedAt: null,
  hardDeletedAt: null,
  sharedWithOrg: false,
  createdAt: fixedDate,
  updatedAt: fixedDate,
  ...overrides
})

type AssetUpdateInput = {
  readonly id: string
  readonly thumbnailPath?: string | null
  readonly aiTitle?: string | null
  readonly aiDescription?: string | null
  readonly aiTags?: ReadonlyArray<string>
  readonly processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
  readonly processingError?: string | null
  readonly sharedWithOrg?: boolean
}

const runGenerate = (asset: MediaAssetRecord) => {
  const getObject = vi.fn()
  const putObject = vi.fn()
  const update = vi.fn()
  const generateImageThumbnail = vi.fn()

  const getObjectEffect = (storagePath: string) => {
    getObject(storagePath)
    return Effect.succeed(new Uint8Array([1, 2, 3]))
  }
  const putObjectEffect = (input: { readonly storagePath: string; readonly body: Uint8Array; readonly mimeType: string }) => {
    putObject(input)
    return Effect.void
  }
  const updateEffect = (input: AssetUpdateInput) => {
    update(input)
    return Effect.succeed(Option.some({
      ...asset,
      thumbnailPath: input.thumbnailPath ?? asset.thumbnailPath,
      processingError: input.processingError ?? asset.processingError
    }))
  }
  const generateImageThumbnailEffect = (input: { readonly body: Uint8Array; readonly mimeType: string }) => {
    generateImageThumbnail(input)
    return Effect.succeed({
      body: new Uint8Array([4, 5, 6]),
      mimeType: 'image/webp'
    })
  }

  const mediaAssetStore = Layer.succeed(MediaAssetStorePort, {
    list: () => Effect.die('unused'),
    search: () => Effect.die('unused'),
    getById: () => Effect.succeed(Option.some(asset)),
    getByIdIncludeDeleted: () => Effect.die('unused'),
    getManyByIds: () => Effect.die('unused'),
    findByContentHash: () => Effect.die('unused'),
    create: () => Effect.die('unused'),
    update: updateEffect,
    softDelete: () => Effect.die('unused'),
    hardDelete: () => Effect.die('unused'),
    markHardDeleted: () => Effect.die('unused'),
    listSoftDeletedForRetention: () => Effect.die('unused'),
    listByOrganization: () => Effect.die('unused'),
    listByOrganizationIncludingDeleted: () => Effect.die('unused')
  })

  const storage = Layer.succeed(StorageAdapterPort, {
    createPresignedUploadUrl: () => Effect.die('unused'),
    createPresignedReadUrl: () => Effect.die('unused'),
    putObject: putObjectEffect,
    getObject: getObjectEffect,
    headObject: () => Effect.die('unused'),
    deleteObject: () => Effect.die('unused'),
    deleteObjects: () => Effect.die('unused')
  })

  const generator = Layer.succeed(ThumbnailGeneratorPort, {
    generateImageThumbnail: generateImageThumbnailEffect
  })

  const effect = Effect.gen(function* () {
    const service = yield* AssetThumbnailService
    return yield* service.generateForAsset({
      teamId: asset.teamId,
      assetId: asset.id
    })
  }).pipe(
    Effect.provide(Layer.mergeAll(
      AssetThumbnailServiceLive,
      mediaAssetStore,
      storage,
      generator
    ))
  )

  return {
    result: runEffectPromise(effect),
    getObject,
    putObject,
    update,
    generateImageThumbnail
  }
}

describe('AssetThumbnailService', () => {
  it('generates and stores a WebP thumbnail for image assets', async () => {
    const asset = makeAsset()
    const expectedPath = buildThumbnailPath(asset.teamId, asset.id, asset.originalFilename)
    const run = runGenerate(asset)

    await expect(run.result).resolves.toEqual({
      status: 'generated',
      thumbnailPath: expectedPath
    })
    expect(run.getObject).toHaveBeenCalledWith(asset.storagePath)
    expect(run.generateImageThumbnail).toHaveBeenCalledWith({
      body: new Uint8Array([1, 2, 3]),
      mimeType: asset.mimeType
    })
    expect(run.putObject).toHaveBeenCalledWith({
      storagePath: expectedPath,
      body: new Uint8Array([4, 5, 6]),
      mimeType: 'image/webp'
    })
    expect(run.update).toHaveBeenCalledWith({
      id: asset.id,
      thumbnailPath: expectedPath,
      processingError: null
    })
  })

  it('skips assets that already have thumbnails', async () => {
    const asset = makeAsset({ thumbnailPath: 'existing/thumb.webp' })
    const run = runGenerate(asset)

    await expect(run.result).resolves.toEqual({
      status: 'skipped',
      reason: 'existing',
      thumbnailPath: 'existing/thumb.webp'
    })
    expect(run.getObject).not.toHaveBeenCalled()
    expect(run.putObject).not.toHaveBeenCalled()
  })

  it('skips non-image assets', async () => {
    const asset = makeAsset({
      assetType: 'document',
      mimeType: 'application/pdf',
      originalFilename: 'brief.pdf'
    })
    const run = runGenerate(asset)

    await expect(run.result).resolves.toEqual({
      status: 'skipped',
      reason: 'unsupported_type',
      thumbnailPath: null
    })
    expect(run.getObject).not.toHaveBeenCalled()
    expect(run.putObject).not.toHaveBeenCalled()
  })
})
