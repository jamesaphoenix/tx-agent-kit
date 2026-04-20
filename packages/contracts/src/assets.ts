import * as Schema from 'effect/Schema'
import { assetCategories, assetTypes, pendingUploadStatuses, processingStatuses } from './literals.js'
import { listParamsSchema, paginatedResponseSchema } from './common.js'

export const assetTypeSchema = Schema.Literal(...assetTypes)
export const assetCategorySchema = Schema.Literal(...assetCategories)
export const processingStatusSchema = Schema.Literal(...processingStatuses)
export const pendingUploadStatusSchema = Schema.Literal(...pendingUploadStatuses)

// ── Per-type metadata schemas (populated by ffprobe/mediainfo on ingestion) ──

export const imageMetadataSchema = Schema.Struct({
  type: Schema.Literal('image'),
  width: Schema.Number,
  height: Schema.Number,
  format: Schema.String,
  colorSpace: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.String)
})

export const videoMetadataSchema = Schema.Struct({
  type: Schema.Literal('video'),
  width: Schema.Number,
  height: Schema.Number,
  duration: Schema.Number,
  codec: Schema.String,
  bitrate: Schema.optional(Schema.Number),
  fps: Schema.optional(Schema.Number),
  aspectRatio: Schema.optional(Schema.String)
})

export const audioMetadataSchema = Schema.Struct({
  type: Schema.Literal('audio'),
  duration: Schema.Number,
  sampleRate: Schema.optional(Schema.Number),
  channels: Schema.optional(Schema.Number),
  codec: Schema.String
})

export const gifMetadataSchema = Schema.Struct({
  type: Schema.Literal('gif'),
  width: Schema.Number,
  height: Schema.Number,
  frameCount: Schema.Number,
  duration: Schema.optional(Schema.Number),
  aspectRatio: Schema.optional(Schema.String)
})

export const documentMetadataSchema = Schema.Struct({
  type: Schema.Literal('document'),
  pageCount: Schema.optional(Schema.Number),
  format: Schema.String
})

export const assetTypeDataSchema = Schema.Union(
  imageMetadataSchema,
  videoMetadataSchema,
  audioMetadataSchema,
  gifMetadataSchema,
  documentMetadataSchema
)

export type ImageMetadata = Schema.Schema.Type<typeof imageMetadataSchema>
export type VideoMetadata = Schema.Schema.Type<typeof videoMetadataSchema>
export type AudioMetadata = Schema.Schema.Type<typeof audioMetadataSchema>
export type GifMetadata = Schema.Schema.Type<typeof gifMetadataSchema>
export type DocumentMetadata = Schema.Schema.Type<typeof documentMetadataSchema>
export type AssetTypeData = Schema.Schema.Type<typeof assetTypeDataSchema>

// ── Daily storage snapshot schema ────────────────────────────────────

export const dailyStorageSnapshotSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  snapshotDate: Schema.String,
  highWaterMarkBytes: Schema.Number,
  includedBytes: Schema.Number,
  overageBytes: Schema.Number,
  overageCostDecimillicents: Schema.Number,
  ledgerEntryId: Schema.NullOr(Schema.UUID),
  createdAt: Schema.String
})

export type DailyStorageSnapshot = Schema.Schema.Type<typeof dailyStorageSnapshotSchema>

export const mediaAssetSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  originalFilename: Schema.String,
  fileSize: Schema.Number,
  mimeType: Schema.String,
  assetType: assetTypeSchema,
  assetCategory: assetCategorySchema,
  assetTypeData: Schema.NullOr(Schema.Unknown),
  storagePath: Schema.String,
  thumbnailPath: Schema.NullOr(Schema.String),
  aiTitle: Schema.NullOr(Schema.String),
  aiDescription: Schema.NullOr(Schema.String),
  aiTags: Schema.Array(Schema.String),
  contentHash: Schema.NullOr(Schema.String),
  processingStatus: processingStatusSchema,
  processingError: Schema.NullOr(Schema.String),
  isDeleted: Schema.Boolean,
  deletedAt: Schema.NullOr(Schema.String),
  hardDeletedAt: Schema.NullOr(Schema.String),
  sharedWithOrg: Schema.Boolean,
  // Computed domain fields
  displayName: Schema.String,
  aspectRatio: Schema.NullOr(Schema.String),
  isProcessing: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const collectionSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const storageMeteringSchema = Schema.Struct({
  organizationId: Schema.UUID,
  activeBytes: Schema.Number,
  softDeletedBytes: Schema.Number,
  activeAssetCount: Schema.Number,
  softDeletedAssetCount: Schema.Number,
  highWaterMarkBytes: Schema.Number,
  measuredAt: Schema.String
})

// --- Upload flow request/response schemas ---

export const requestUploadBodySchema = Schema.Struct({
  fileName: Schema.String.pipe(Schema.minLength(1)),
  fileSize: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  contentHash: Schema.NullOr(Schema.String),
  mimeType: Schema.String.pipe(Schema.minLength(1))
})

export const requestUploadResponseSchema = Schema.Struct({
  uploadId: Schema.UUID,
  presignedUrl: Schema.String,
  deduplicated: Schema.Boolean,
  existingAssetId: Schema.NullOr(Schema.UUID)
})

export const uploadContentResponseSchema = Schema.Struct({
  uploaded: Schema.Boolean
})

export const confirmUploadResponseSchema = mediaAssetSchema

// --- Asset CRUD schemas ---

export const updateAssetMetadataBodySchema = Schema.Struct({
  aiTitle: Schema.optional(Schema.NullOr(Schema.String)),
  aiDescription: Schema.optional(Schema.NullOr(Schema.String)),
  aiTags: Schema.optional(Schema.Array(Schema.String)),
  sharedWithOrg: Schema.optional(Schema.Boolean)
})

export const assetsListParamsSchema = Schema.Struct({
  ...listParamsSchema.fields,
  'filter[assetType]': Schema.optional(assetTypeSchema)
})

export const assetSearchParamsSchema = Schema.Struct({
  query: Schema.String.pipe(Schema.minLength(1)),
  semantic: Schema.optional(Schema.String),
  ...listParamsSchema.fields,
  'filter[assetType]': Schema.optional(assetTypeSchema)
})

export const assetSignedUrlResponseSchema = Schema.Struct({
  url: Schema.String
})

export const assetThumbnailSignedUrlResponseSchema = Schema.Struct({
  url: Schema.NullOr(Schema.String)
})

export const listAssetsResponseSchema = paginatedResponseSchema(mediaAssetSchema)

// --- Collection CRUD schemas ---

export const createCollectionBodySchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  description: Schema.optional(Schema.NullOr(Schema.String))
})

export const updateCollectionBodySchema = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128))),
  description: Schema.optional(Schema.NullOr(Schema.String))
})

export const addAssetToCollectionBodySchema = Schema.Struct({
  assetId: Schema.UUID
})

export const collectionsListParamsSchema = Schema.Struct({
  ...listParamsSchema.fields
})

export const listCollectionsResponseSchema = paginatedResponseSchema(collectionSchema)
export const listCollectionAssetsResponseSchema = paginatedResponseSchema(mediaAssetSchema)

// --- Storage metering schemas ---

export const storageUsageResponseSchema = storageMeteringSchema

export const storageQuotaResponseSchema = Schema.Struct({
  allowed: Schema.Boolean,
  currentBytes: Schema.Number,
  limitBytes: Schema.Number
})

// --- Type exports ---

export type MediaAsset = Schema.Schema.Type<typeof mediaAssetSchema>
export type Collection = Schema.Schema.Type<typeof collectionSchema>
export type StorageMetering = Schema.Schema.Type<typeof storageMeteringSchema>
export type RequestUploadBody = Schema.Schema.Type<typeof requestUploadBodySchema>
export type RequestUploadResponse = Schema.Schema.Type<typeof requestUploadResponseSchema>
export type UpdateAssetMetadataBody = Schema.Schema.Type<typeof updateAssetMetadataBodySchema>
export type AssetSearchParams = Schema.Schema.Type<typeof assetSearchParamsSchema>
export type CreateCollectionBody = Schema.Schema.Type<typeof createCollectionBodySchema>
export type UpdateCollectionBody = Schema.Schema.Type<typeof updateCollectionBodySchema>
export type AddAssetToCollectionBody = Schema.Schema.Type<typeof addAssetToCollectionBodySchema>
export type StorageQuotaResponse = Schema.Schema.Type<typeof storageQuotaResponseSchema>
