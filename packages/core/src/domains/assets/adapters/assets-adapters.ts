import {
  teamMediaAssetsRepository,
  pendingUploadsRepository,
  storageMeteringRepository,
  mediaCollectionsRepository,
  teamsRepository,
  billingRepository
} from '@tx-agent-kit/db'
import { Storage } from '@tx-agent-kit/storage'
import { Effect, Layer, Option } from 'effect'
import {
  mapOptional,
  toMediaAssetRecord,
  toMediaAssetRecordPage,
  toPendingUploadRecord,
  toStorageMeteringRecord,
  toCollectionRecord,
  toCollectionRecordPage
} from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import {
  MediaAssetStorePort,
  PendingUploadStorePort,
  StorageMeteringPort,
  CollectionStorePort,
  StorageAdapterPort,
  TeamLookupPort,
  SubscriptionLookupPort
} from '../ports/assets-ports.js'

export const MediaAssetStorePortLive = Layer.succeed(MediaAssetStorePort, {
  list: (teamId: string, params: ListParams) =>
    teamMediaAssetsRepository.list(teamId, params).pipe(Effect.map(toMediaAssetRecordPage)),
  search: (teamId: string, query: string, params: ListParams) =>
    teamMediaAssetsRepository.search(teamId, query, params).pipe(Effect.map(toMediaAssetRecordPage)),
  getById: (id: string) =>
    teamMediaAssetsRepository.getById(id).pipe(Effect.map((opt) => mapOptional(opt, toMediaAssetRecord))),
  getByIdIncludeDeleted: (id: string) =>
    teamMediaAssetsRepository.getByIdIncludeDeleted(id).pipe(Effect.map((opt) => mapOptional(opt, toMediaAssetRecord))),
  getManyByIds: (ids: ReadonlyArray<string>) =>
    teamMediaAssetsRepository.getManyByIds(ids).pipe(Effect.map((rows) => rows.map(toMediaAssetRecord))),
  findByContentHash: (teamId: string, contentHash: string) =>
    teamMediaAssetsRepository.findByContentHash(teamId, contentHash).pipe(Effect.map((opt) => mapOptional(opt, toMediaAssetRecord))),
  create: (input) =>
    teamMediaAssetsRepository.create(input).pipe(Effect.map((opt) => mapOptional(opt, toMediaAssetRecord))),
  update: (input) =>
    teamMediaAssetsRepository.update(input).pipe(Effect.map((opt) => mapOptional(opt, toMediaAssetRecord))),
  softDelete: (id: string) =>
    teamMediaAssetsRepository.softDelete(id).pipe(Effect.map((opt) => mapOptional(opt, toMediaAssetRecord))),
  hardDelete: (id: string) =>
    teamMediaAssetsRepository.hardDelete(id),
  markHardDeleted: (id: string) =>
    teamMediaAssetsRepository.markHardDeleted(id).pipe(Effect.map((opt) => mapOptional(opt, toMediaAssetRecord))),
  listSoftDeletedForRetention: (input) =>
    teamMediaAssetsRepository.listSoftDeletedForRetention(input).pipe(Effect.map((rows) => rows.map(toMediaAssetRecord))),
  listByOrganization: (organizationId: string, params: ListParams) =>
    teamMediaAssetsRepository.listByOrganization(organizationId, params).pipe(Effect.map(toMediaAssetRecordPage)),
  listByOrganizationIncludingDeleted: (organizationId: string, params: ListParams) =>
    teamMediaAssetsRepository
      .listByOrganizationIncludingDeleted(organizationId, params)
      .pipe(Effect.map(toMediaAssetRecordPage))
})

export const PendingUploadStorePortLive = Layer.succeed(PendingUploadStorePort, {
  getById: (id: string) =>
    pendingUploadsRepository.getById(id).pipe(Effect.map((opt) => mapOptional(opt, toPendingUploadRecord))),
  create: (input) =>
    pendingUploadsRepository.create(input).pipe(Effect.map((opt) => mapOptional(opt, toPendingUploadRecord))),
  confirm: (id: string) =>
    pendingUploadsRepository.confirm(id).pipe(Effect.map((opt) => mapOptional(opt, toPendingUploadRecord))),
  markExpired: (id: string) =>
    pendingUploadsRepository.markExpired(id).pipe(Effect.map((opt) => mapOptional(opt, toPendingUploadRecord))),
  markFailed: (id: string) =>
    pendingUploadsRepository.markFailed(id).pipe(Effect.map((opt) => mapOptional(opt, toPendingUploadRecord))),
  listExpired: (now: Date, limit: number) =>
    pendingUploadsRepository.listExpired(now, limit).pipe(Effect.map((rows) => rows.map(toPendingUploadRecord)))
})

export const StorageMeteringPortLive = Layer.succeed(StorageMeteringPort, {
  getForOrganization: (organizationId: string) =>
    storageMeteringRepository.getForOrganization(organizationId).pipe(Effect.map((opt) => mapOptional(opt, toStorageMeteringRecord))),
  incrementBytes: (organizationId: string, deltaBytes: number) =>
    storageMeteringRepository.incrementBytes(organizationId, deltaBytes),
  decrementBytes: (organizationId: string, deltaBytes: number) =>
    storageMeteringRepository.decrementBytes(organizationId, deltaBytes),
  snapshot: (organizationId: string) =>
    storageMeteringRepository.snapshot(organizationId).pipe(Effect.map(toStorageMeteringRecord))
})

export const CollectionStorePortLive = Layer.succeed(CollectionStorePort, {
  list: (teamId: string, params: ListParams) =>
    mediaCollectionsRepository.list(teamId, params).pipe(Effect.map(toCollectionRecordPage)),
  getById: (id: string) =>
    mediaCollectionsRepository.getById(id).pipe(Effect.map((opt) => mapOptional(opt, toCollectionRecord))),
  create: (input) =>
    mediaCollectionsRepository.create(input).pipe(Effect.map((opt) => mapOptional(opt, toCollectionRecord))),
  update: (input) =>
    mediaCollectionsRepository.update(input).pipe(Effect.map((opt) => mapOptional(opt, toCollectionRecord))),
  remove: (id: string) =>
    mediaCollectionsRepository.remove(id),
  addAsset: (collectionId: string, assetId: string) =>
    mediaCollectionsRepository.addAsset(collectionId, assetId),
  removeAsset: (collectionId: string, assetId: string) =>
    mediaCollectionsRepository.removeAsset(collectionId, assetId),
  listAssets: (collectionId: string, params: ListParams) =>
    mediaCollectionsRepository.listAssets(collectionId, params).pipe(Effect.map(toMediaAssetRecordPage))
})

export const StorageAdapterPortLive = Layer.effect(
  StorageAdapterPort,
  Effect.gen(function* () {
    const storage = yield* Storage

    return {
      createPresignedUploadUrl: (input: {
        storagePath: string
        mimeType: string
        maxBytes: number
        expiresInSeconds: number
      }) =>
        storage.generateUploadUrl(input.storagePath, input.mimeType, input.expiresInSeconds).pipe(
          Effect.map((url) => ({
            url,
            expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000)
          }))
        ),

      createPresignedReadUrl: (input: { storagePath: string; expiresInSeconds: number }) =>
        storage.generateDownloadUrl(input.storagePath, input.expiresInSeconds),

      putObject: (input: { storagePath: string; body: Uint8Array; mimeType: string }) =>
        storage.putObject(input.storagePath, input.body, input.mimeType),

      getObject: (storagePath: string) =>
        storage.getObject(storagePath),

      headObject: (storagePath: string) =>
        storage.getObjectMetadata(storagePath).pipe(
          Effect.map((meta) => ({
            size: meta.contentLength ?? 0,
            contentType: meta.contentType ?? 'application/octet-stream'
          }))
        ),

      deleteObject: (storagePath: string) =>
        storage.deleteObject(storagePath),

      deleteObjects: (storagePaths: ReadonlyArray<string>) =>
        Effect.forEach(storagePaths, (path) => storage.deleteObject(path), { discard: true })
    }
  })
)

export const TeamLookupPortLive = Layer.succeed(TeamLookupPort, {
  getOrganizationId: (teamId: string) =>
    teamsRepository.getById(teamId).pipe(
      Effect.map((opt) => Option.flatMap(opt, (row) => Option.fromNullable(row.organizationId)))
    )
})

export const SubscriptionLookupPortLive = Layer.succeed(SubscriptionLookupPort, {
  getSubscriptionInfo: (organizationId: string) =>
    billingRepository.getSubscriptionFields(organizationId).pipe(
      Effect.map((opt) =>
        Option.map(opt, (row) => ({
          isSubscribed: row.isSubscribed,
          subscriptionPlan: row.subscriptionPlan,
          creditsBalance: row.creditsBalance,
          reservedCredits: row.reservedCredits
        }))
      )
    )
})
