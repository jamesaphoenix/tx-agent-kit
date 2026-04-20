import { Context, Effect, Layer, Option } from 'effect'
import { internalError, notFound, type CoreError } from '../../../errors.js'
import { requireOwnership } from '../../../effect-utils.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { CollectionRecord, MediaAssetRecord } from '../domain/assets-domain.js'
import {
  CollectionStorePort,
  MediaAssetStorePort
} from '../ports/assets-ports.js'

type CollectionStore = {
  readonly getById: (id: string) => Effect.Effect<Option.Option<CollectionRecord>, unknown>
}

export class CollectionService extends Context.Tag('CollectionService')<
  CollectionService,
  {
    list: (
      teamId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<CollectionRecord>, CoreError, CollectionStorePort>
    create: (input: {
      teamId: string
      name: string
      description: string | null
    }) => Effect.Effect<CollectionRecord, CoreError, CollectionStorePort>
    update: (input: {
      teamId: string
      collectionId: string
      name?: string
      description?: string | null
    }) => Effect.Effect<CollectionRecord, CoreError, CollectionStorePort>
    remove: (
      teamId: string,
      collectionId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, CollectionStorePort>
    listAssets: (
      teamId: string,
      collectionId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<MediaAssetRecord>, CoreError, CollectionStorePort>
    addAsset: (
      teamId: string,
      collectionId: string,
      assetId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, CollectionStorePort | MediaAssetStorePort>
    removeAsset: (
      teamId: string,
      collectionId: string,
      assetId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, CollectionStorePort>
  }
>() {}

const getOwnedCollection = (
  store: CollectionStore,
  teamId: string,
  collectionId: string
) =>
  Effect.gen(function* () {
    const collection = yield* store.getById(collectionId).pipe(
      Effect.mapError((cause) => internalError('Failed to get collection', cause)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(notFound('Collection not found')),
        onSome: Effect.succeed
      }))
    )
    yield* requireOwnership(collection, teamId, 'teamId', 'Collection not found', { collectionId, teamId })
    return collection
  })

export const CollectionServiceLive = Layer.effect(
  CollectionService,
  Effect.succeed({
    list: (teamId, params) =>
      Effect.gen(function* () {
        const store = yield* CollectionStorePort
        return yield* store.list(teamId, params).pipe(
          Effect.mapError((cause) => internalError('Failed to list collections', cause))
        )
      }),

    create: (input) =>
      Effect.gen(function* () {
        const store = yield* CollectionStorePort
        const collection = yield* store.create(input).pipe(
          Effect.mapError((cause) => internalError('Failed to create collection', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Failed to create collection')),
            onSome: Effect.succeed
          }))
        )
        return collection
      }),

    update: (input) =>
      Effect.gen(function* () {
        const store = yield* CollectionStorePort
        yield* getOwnedCollection(store, input.teamId, input.collectionId)

        const collection = yield* store.update({
          id: input.collectionId,
          name: input.name,
          description: input.description
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to update collection', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Failed to update collection')),
            onSome: Effect.succeed
          }))
        )
        return collection
      }),

    remove: (teamId, collectionId) =>
      Effect.gen(function* () {
        const store = yield* CollectionStorePort
        yield* getOwnedCollection(store, teamId, collectionId)
        return yield* store.remove(collectionId).pipe(
          Effect.mapError((cause) => internalError('Failed to remove collection', cause))
        )
      }),

    listAssets: (teamId, collectionId, params) =>
      Effect.gen(function* () {
        const store = yield* CollectionStorePort
        yield* getOwnedCollection(store, teamId, collectionId)
        return yield* store.listAssets(collectionId, params).pipe(
          Effect.mapError((cause) => internalError('Failed to list collection assets', cause))
        )
      }),

    addAsset: (teamId, collectionId, assetId) =>
      Effect.gen(function* () {
        const collectionStore = yield* CollectionStorePort
        const assetStore = yield* MediaAssetStorePort
        yield* getOwnedCollection(collectionStore, teamId, collectionId)

        const asset = yield* assetStore.getById(assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to get asset', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Asset not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(asset, teamId, 'teamId', 'Asset not found', { assetId, teamId })

        yield* collectionStore.addAsset(collectionId, assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to add asset to collection', cause))
        )
        return { deleted: true as const }
      }),

    removeAsset: (teamId, collectionId, assetId) =>
      Effect.gen(function* () {
        const store = yield* CollectionStorePort
        yield* getOwnedCollection(store, teamId, collectionId)
        yield* store.removeAsset(collectionId, assetId).pipe(
          Effect.mapError((cause) => internalError('Failed to remove asset from collection', cause))
        )
        return { deleted: true as const }
      })
  })
)
