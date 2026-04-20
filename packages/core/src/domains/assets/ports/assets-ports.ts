import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { DomainEventAggregateType, DomainEventType } from '@tx-agent-kit/contracts'
import type { JsonObject } from '@tx-agent-kit/db'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { MediaAssetRecord, PendingUploadRecord, StorageMeteringRecord, CollectionRecord } from '../domain/assets-domain.js'

export const AssetsRepositoryKind = 'crud' as const

export type { MediaAssetRecord, PendingUploadRecord, StorageMeteringRecord, CollectionRecord }

export class MediaAssetStorePort extends Context.Tag('MediaAssetStorePort')<
  MediaAssetStorePort,
  {
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
    search: (
      teamId: string,
      query: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    getByIdIncludeDeleted: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    getManyByIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<MediaAssetRecord>, unknown>
    findByContentHash: (teamId: string, contentHash: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    create: (input: {
      id?: string
      teamId: string
      originalFilename: string
      fileSize: number
      mimeType: string
      assetType: 'image' | 'video' | 'audio' | 'gif' | 'document'
      storagePath: string
      thumbnailPath: string | null
      contentHash: string | null
      processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
      outboxEvent?: {
        eventType: DomainEventType
        aggregateType: DomainEventAggregateType
        aggregateId: string
        payload: JsonObject
        correlationId?: string | null
      }
    }) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    update: (input: {
      id: string
      thumbnailPath?: string | null
      aiTitle?: string | null
      aiDescription?: string | null
      aiTags?: ReadonlyArray<string>
      processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
      processingError?: string | null
      sharedWithOrg?: boolean
    }) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    softDelete: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    hardDelete: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    markHardDeleted: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    listSoftDeletedForRetention: (input: {
      olderThan: Date
      limit: number
    }) => Effect.Effect<ReadonlyArray<MediaAssetRecord>, unknown>
    listByOrganization: (organizationId: string, params: ListParams) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
    listByOrganizationIncludingDeleted: (
      organizationId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
  }
>() {}

export class PendingUploadStorePort extends Context.Tag('PendingUploadStorePort')<
  PendingUploadStorePort,
  {
    getById: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    create: (input: {
      teamId: string
      userId: string
      declaredFileSize: number
      contentHash: string | null
      mimeType: string
      storagePath: string
      presignedUrl: string
      expiresAt: Date
    }) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    confirm: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    markExpired: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    markFailed: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    listExpired: (now: Date, limit: number) => Effect.Effect<ReadonlyArray<PendingUploadRecord>, unknown>
  }
>() {}

export class StorageMeteringPort extends Context.Tag('StorageMeteringPort')<
  StorageMeteringPort,
  {
    getForOrganization: (organizationId: string) => Effect.Effect<Option.Option<StorageMeteringRecord>, unknown>
    incrementBytes: (organizationId: string, deltaBytes: number) => Effect.Effect<void, unknown>
    decrementBytes: (organizationId: string, deltaBytes: number) => Effect.Effect<void, unknown>
    snapshot: (organizationId: string) => Effect.Effect<StorageMeteringRecord, unknown>
  }
>() {}

export class CollectionStorePort extends Context.Tag('CollectionStorePort')<
  CollectionStorePort,
  {
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<CollectionRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<CollectionRecord>, unknown>
    create: (input: {
      teamId: string
      name: string
      description: string | null
    }) => Effect.Effect<Option.Option<CollectionRecord>, unknown>
    update: (input: {
      id: string
      name?: string
      description?: string | null
    }) => Effect.Effect<Option.Option<CollectionRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    addAsset: (collectionId: string, assetId: string) => Effect.Effect<void, unknown>
    removeAsset: (collectionId: string, assetId: string) => Effect.Effect<void, unknown>
    listAssets: (collectionId: string, params: ListParams) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
  }
>() {}

export class StorageAdapterPort extends Context.Tag('StorageAdapterPort')<
  StorageAdapterPort,
  {
    createPresignedUploadUrl: (input: {
      storagePath: string
      mimeType: string
      maxBytes: number
      expiresInSeconds: number
    }) => Effect.Effect<{ url: string; expiresAt: Date }, unknown>
    createPresignedReadUrl: (input: {
      storagePath: string
      expiresInSeconds: number
    }) => Effect.Effect<string, unknown>
    putObject: (input: {
      storagePath: string
      body: Uint8Array
      mimeType: string
    }) => Effect.Effect<void, unknown>
    getObject: (storagePath: string) => Effect.Effect<Uint8Array, unknown>
    headObject: (storagePath: string) => Effect.Effect<{ size: number; contentType: string }, unknown>
    deleteObject: (storagePath: string) => Effect.Effect<void, unknown>
    deleteObjects: (storagePaths: ReadonlyArray<string>) => Effect.Effect<void, unknown>
  }
>() {}

export class ThumbnailGeneratorPort extends Context.Tag('ThumbnailGeneratorPort')<
  ThumbnailGeneratorPort,
  {
    generateImageThumbnail: (input: {
      body: Uint8Array
      mimeType: string
    }) => Effect.Effect<{
      body: Uint8Array
      mimeType: string
    }, unknown>
  }
>() {}

export class TeamLookupPort extends Context.Tag('TeamLookupPort')<
  TeamLookupPort,
  {
    getOrganizationId: (teamId: string) => Effect.Effect<Option.Option<string>, unknown>
  }
>() {}

export class SubscriptionLookupPort extends Context.Tag('SubscriptionLookupPort')<
  SubscriptionLookupPort,
  {
    getSubscriptionInfo: (organizationId: string) => Effect.Effect<
      Option.Option<{
        isSubscribed: boolean
        subscriptionPlan: string | null
        creditsBalance: number
        reservedCredits: number
      }>,
      unknown
    >
  }
>() {}
