import { Context, Effect, Either, Layer, Option } from 'effect'
import { UPLOAD_EXPIRY_SECONDS } from '@tx-agent-kit/contracts'
import { badRequest, forbidden, internalError, notFound, paymentRequired, unauthorized, type CoreError } from '../../../errors.js'
import { deriveAssetType, buildStoragePath, validateAssetUpload, type MediaAssetRecord } from '../domain/assets-domain.js'
import { assetsEvents } from '../events.js'
import {
  MediaAssetStorePort,
  PendingUploadStorePort,
  StorageMeteringPort,
  StorageAdapterPort,
  TeamLookupPort
} from '../ports/assets-ports.js'
import type { SubscriptionLookupPort } from '../ports/assets-ports.js'
import { StorageMeteringService } from './storage-metering-service.js'

export class UploadService extends Context.Tag('UploadService')<
  UploadService,
  {
    requestUpload: (input: {
      teamId: string
      userId: string
      fileName: string
      fileSize: number
      contentHash: string | null
      mimeType: string
    }) => Effect.Effect<
      {
        uploadId: string
        presignedUrl: string
        deduplicated: boolean
        existingAssetId: string | null
      },
      CoreError,
      | MediaAssetStorePort
      | PendingUploadStorePort
      | StorageAdapterPort
      | StorageMeteringPort
      | SubscriptionLookupPort
      | StorageMeteringService
      | TeamLookupPort
    >
    uploadContent: (
      teamId: string,
      uploadId: string,
      body: Uint8Array,
      contentType: string
    ) => Effect.Effect<
      { uploaded: true },
      CoreError,
      PendingUploadStorePort | StorageAdapterPort
    >
    confirmUpload: (
      teamId: string,
      uploadId: string
    ) => Effect.Effect<
      MediaAssetRecord,
      CoreError,
      MediaAssetStorePort | PendingUploadStorePort | StorageMeteringPort | StorageAdapterPort | TeamLookupPort
    >
  }
>() {}

export const UploadServiceLive = Layer.effect(
  UploadService,
  Effect.succeed({
    requestUpload: (input) =>
      Effect.gen(function* () {
        const assetStore = yield* MediaAssetStorePort
        const uploadStore = yield* PendingUploadStorePort
        const storageAdapter = yield* StorageAdapterPort
        const teamLookup = yield* TeamLookupPort
        const meteringService = yield* StorageMeteringService

        // Validate the upload input (filename, size, MIME type) before any quota
        // or billing lookup so invalid sizes cannot affect quota projections.
        const validated = validateAssetUpload({
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType
        })
        if (Either.isLeft(validated)) {
          return yield* Effect.fail(badRequest(validated.left.code))
        }
        const { filename, fileSize } = validated.right

        // Resolve organizationId from teamId (metering is per-org)
        const organizationId = yield* teamLookup.getOrganizationId(input.teamId).pipe(
          Effect.mapError((cause) => internalError('Failed to resolve organization for team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Team has no organization')),
            onSome: Effect.succeed
          }))
        )

        // Enforce storage quota before generating presigned URL
        const quota = yield* meteringService.checkQuota(organizationId, fileSize)
        if (!quota.hasSubscription) {
          return yield* Effect.fail(forbidden('Subscription required to upload files'))
        }
        if (!quota.allowed) {
          return yield* Effect.fail(paymentRequired('Storage quota exceeded. Upgrade your plan or remove unused files.'))
        }

        // Check dedup by content_hash
        if (input.contentHash) {
          const maybeExisting = yield* assetStore.findByContentHash(input.teamId, input.contentHash).pipe(
            Effect.mapError((cause) => internalError('Failed to check content hash', cause))
          )
          if (Option.isSome(maybeExisting)) {
            const existing = maybeExisting.value
            return {
              uploadId: existing.id,
              presignedUrl: '',
              deduplicated: true,
              existingAssetId: existing.id
            }
          }
        }

        // Generate storage path using a temporary UUID (will be the pending upload ID)
        const tempId = crypto.randomUUID()
        const storagePath = buildStoragePath(input.teamId, tempId, filename)

        // Generate presigned upload URL.
        const presigned = yield* storageAdapter.createPresignedUploadUrl({
          storagePath,
          mimeType: input.mimeType,
          maxBytes: fileSize,
          expiresInSeconds: UPLOAD_EXPIRY_SECONDS
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to generate presigned URL', cause))
        )

        // Create pending_uploads row
        const pending = yield* uploadStore.create({
          teamId: input.teamId,
          userId: input.userId,
          declaredFileSize: fileSize,
          contentHash: input.contentHash,
          mimeType: input.mimeType,
          storagePath,
          presignedUrl: presigned.url,
          expiresAt: presigned.expiresAt
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to create pending upload', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Failed to create pending upload')),
            onSome: Effect.succeed
          }))
        )

        return {
          uploadId: pending.id,
          presignedUrl: presigned.url,
          deduplicated: false,
          existingAssetId: null
        }
      }),

    uploadContent: (teamId, uploadId, body, contentType) =>
      Effect.gen(function* () {
        const uploadStore = yield* PendingUploadStorePort
        const storageAdapter = yield* StorageAdapterPort

        const pending = yield* uploadStore.getById(uploadId).pipe(
          Effect.mapError((cause) => internalError('Failed to get pending upload', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Pending upload not found')),
            onSome: Effect.succeed
          }))
        )

        if (pending.teamId !== teamId) {
          return yield* Effect.fail(unauthorized('Upload does not belong to this team'))
        }

        if (pending.status !== 'pending') {
          return yield* Effect.fail(badRequest(`Upload already ${pending.status}`))
        }

        if (contentType && contentType !== pending.mimeType) {
          return yield* Effect.fail(badRequest('Uploaded content type does not match the requested upload'))
        }

        // @spec INV-AST-006
        if (body.byteLength !== pending.declaredFileSize) {
          return yield* Effect.fail(badRequest('Uploaded content length does not match the requested upload'))
        }

        yield* storageAdapter.putObject({
          storagePath: pending.storagePath,
          body,
          mimeType: pending.mimeType
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to upload file content', cause))
        )

        return { uploaded: true as const }
      }),

    confirmUpload: (teamId, uploadId) =>
      Effect.gen(function* () {
        const assetStore = yield* MediaAssetStorePort
        const uploadStore = yield* PendingUploadStorePort
        const meteringPort = yield* StorageMeteringPort
        const storageAdapter = yield* StorageAdapterPort
        const teamLookup = yield* TeamLookupPort

        // Get the pending upload
        const pending = yield* uploadStore.getById(uploadId).pipe(
          Effect.mapError((cause) => internalError('Failed to get pending upload', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Pending upload not found')),
            onSome: Effect.succeed
          }))
        )

        // SECURITY: verify the upload belongs to the caller's team (prevents cross-team IDOR)
        if (pending.teamId !== teamId) {
          return yield* Effect.fail(unauthorized('Upload does not belong to this team'))
        }

        if (pending.status !== 'pending') {
          return yield* Effect.fail(badRequest(`Upload already ${pending.status}`))
        }

        // @spec INV-AST-006
        // @spec INV-AST-010
        // Verify actual file size via HeadObject before creating billable records.
        const headResult = yield* storageAdapter.headObject(pending.storagePath).pipe(
          Effect.mapError((cause) => internalError('Failed to verify uploaded file', cause))
        )

        const actualFileSize = headResult.size
        if (actualFileSize !== pending.declaredFileSize) {
          yield* storageAdapter.deleteObject(pending.storagePath).pipe(
            Effect.mapError((cause) => internalError('Failed to delete mismatched uploaded file', cause))
          )
          yield* uploadStore.markFailed(uploadId).pipe(
            Effect.mapError((cause) => internalError('Failed to mark upload failed', cause))
          )
          return yield* Effect.fail(badRequest('Uploaded object size does not match the requested upload'))
        }

        const assetType = deriveAssetType(pending.mimeType)
        const assetId = crypto.randomUUID()

        // Create the team_media_assets row
        const asset = yield* assetStore.create({
          id: assetId,
          teamId: pending.teamId,
          originalFilename: pending.storagePath.split('/').pop()?.split('_').slice(1).join('_') ?? 'unknown',
          fileSize: actualFileSize,
          mimeType: pending.mimeType,
          assetType,
          storagePath: pending.storagePath,
          thumbnailPath: null,
          contentHash: pending.contentHash,
          processingStatus: 'completed',
          outboxEvent: assetType === 'image' || assetType === 'gif'
            ? {
                eventType: assetsEvents.thumbnailRequested,
                aggregateType: 'assets',
                aggregateId: assetId,
                payload: {
                  assetId,
                  teamId: pending.teamId
                }
              }
            : undefined
        }).pipe(
          Effect.mapError((cause) => internalError('Failed to create asset record', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Failed to create asset record')),
            onSome: Effect.succeed
          }))
        )

        // Confirm the pending upload
        yield* uploadStore.confirm(uploadId).pipe(
          Effect.mapError((cause) => internalError('Failed to confirm upload', cause))
        )

        // Resolve organizationId from the team (metering is per-org, not per-team)
        const organizationId = yield* teamLookup.getOrganizationId(pending.teamId).pipe(
          Effect.mapError((cause) => internalError('Failed to resolve organization for team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(internalError('Team has no organization')),
            onSome: Effect.succeed
          }))
        )

        // @spec INV-AST-004
        // @spec INV-AST-011
        // Increment active bytes and the high-water mark from verified object size.
        yield* meteringPort.incrementBytes(organizationId, actualFileSize).pipe(
          Effect.mapError((cause) => internalError('Failed to update storage metering', cause))
        )

        return asset
      })
  })
)
