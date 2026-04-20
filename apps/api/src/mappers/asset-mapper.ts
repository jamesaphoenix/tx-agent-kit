import type { MediaAssetRecord, CollectionRecord, StorageMeteringRecord } from '@tx-agent-kit/core'
import { displayName, aspectRatio, isProcessing } from '@tx-agent-kit/core'
import { Option } from 'effect'

export const toApiMediaAsset = (record: MediaAssetRecord) => ({
  id: record.id,
  teamId: record.teamId,
  originalFilename: record.originalFilename,
  fileSize: record.fileSize,
  mimeType: record.mimeType,
  assetType: record.assetType,
  assetCategory: record.assetCategory,
  assetTypeData: record.assetTypeData,
  storagePath: record.storagePath,
  thumbnailPath: record.thumbnailPath,
  aiTitle: record.aiTitle,
  aiDescription: record.aiDescription,
  aiTags: [...record.aiTags],
  contentHash: record.contentHash,
  processingStatus: record.processingStatus,
  processingError: record.processingError,
  isDeleted: record.isDeleted,
  deletedAt: record.deletedAt?.toISOString() ?? null,
  hardDeletedAt: record.hardDeletedAt?.toISOString() ?? null,
  sharedWithOrg: record.sharedWithOrg,
  // Computed domain fields
  displayName: displayName(record),
  aspectRatio: Option.getOrNull(aspectRatio(record)),
  isProcessing: isProcessing(record),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
})

export const toApiCollection = (record: CollectionRecord) => ({
  id: record.id,
  teamId: record.teamId,
  name: record.name,
  description: record.description,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
})

export const toApiStorageMetering = (record: StorageMeteringRecord) => ({
  organizationId: record.organizationId,
  activeBytes: record.activeBytes,
  softDeletedBytes: record.softDeletedBytes,
  activeAssetCount: record.activeAssetCount,
  softDeletedAssetCount: record.softDeletedAssetCount,
  highWaterMarkBytes: record.highWaterMarkBytes,
  measuredAt: record.measuredAt.toISOString()
})
