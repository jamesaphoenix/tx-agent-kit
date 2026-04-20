import { assetCategories, assetTypes, processingStatuses } from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'

export const teamMediaAssetRowSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  originalFilename: Schema.String,
  fileSize: Schema.Number,
  mimeType: Schema.String,
  assetType: Schema.Literal(...assetTypes),
  assetCategory: Schema.Literal(...assetCategories),
  assetTypeData: Schema.NullOr(Schema.Struct({
    type: Schema.String,
    width: Schema.optional(Schema.Number),
    height: Schema.optional(Schema.Number),
    duration: Schema.optional(Schema.Number),
    codec: Schema.optional(Schema.String),
    format: Schema.optional(Schema.String),
    bitrate: Schema.optional(Schema.Number),
    fps: Schema.optional(Schema.Number),
    sampleRate: Schema.optional(Schema.Number),
    channels: Schema.optional(Schema.Number),
    frameCount: Schema.optional(Schema.Number),
    colorSpace: Schema.optional(Schema.String),
    pageCount: Schema.optional(Schema.Number)
  })),
  storagePath: Schema.String,
  thumbnailPath: Schema.NullOr(Schema.String),
  aiTitle: Schema.NullOr(Schema.String),
  aiDescription: Schema.NullOr(Schema.String),
  aiTags: Schema.Array(Schema.String),
  contentCategory: Schema.NullOr(Schema.String),
  emotion: Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.String })),
  purpose: Schema.Array(Schema.String),
  contentHash: Schema.NullOr(Schema.String),
  processingStatus: Schema.Literal(...processingStatuses),
  processingError: Schema.NullOr(Schema.String),
  embeddingGeneratedAt: Schema.NullOr(Schema.DateFromSelf),
  embeddingModel: Schema.NullOr(Schema.String),
  isDeleted: Schema.Boolean,
  deletedAt: Schema.NullOr(Schema.DateFromSelf),
  hardDeletedAt: Schema.NullOr(Schema.DateFromSelf),
  sharedWithOrg: Schema.Boolean,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type TeamMediaAssetRowShape = Schema.Schema.Type<typeof teamMediaAssetRowSchema>
