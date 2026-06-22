import type {
  TeamMediaAssetRowShape,
  PendingUploadRowShape,
  StorageMeteringRowShape,
  MediaCollectionRowShape
} from '@tx-agent-kit/db'
import type {
  MediaAssetRecord,
  PendingUploadRecord,
  StorageMeteringRecord,
  CollectionRecord
} from '../domains/assets/domain/assets-domain.js'
import type { PaginatedResult } from '../pagination.js'
import { mapPaginatedResult } from './row-mapper-utils.js'

export const toMediaAssetRecord = (row: TeamMediaAssetRowShape): MediaAssetRecord =>
  row as MediaAssetRecord

export const toMediaAssetRecordPage = (
  page: PaginatedResult<TeamMediaAssetRowShape>
): PaginatedResult<MediaAssetRecord> => mapPaginatedResult(page, toMediaAssetRecord)

export const toPendingUploadRecord = (row: PendingUploadRowShape): PendingUploadRecord =>
  row

export const toStorageMeteringRecord = (row: StorageMeteringRowShape): StorageMeteringRecord =>
  row

export const toCollectionRecord = (row: MediaCollectionRowShape): CollectionRecord =>
  row

export const toCollectionRecordPage = (
  page: PaginatedResult<MediaCollectionRowShape>
): PaginatedResult<CollectionRecord> => mapPaginatedResult(page, toCollectionRecord)
