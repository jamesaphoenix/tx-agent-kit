import type {
  TeamMediaAssetRowShape,
  PendingUploadRowShape,
  MediaCollectionRowShape,
  StorageMeteringRowShape
} from '@tx-agent-kit/db'
import type { AssetTypeData } from '@tx-agent-kit/contracts'
import { Either, Option } from 'effect'

// Extends row shape — new DB columns appear automatically.
// Omit fields that need type narrowing from generic DB types.
export interface MediaAssetRecord
  extends Omit<TeamMediaAssetRowShape, 'assetTypeData' | 'emotion'> {
  readonly assetTypeData: AssetTypeData | null
  readonly emotion: Record<string, unknown> | null
}

export type PendingUploadRecord = PendingUploadRowShape

export type CollectionRecord = MediaCollectionRowShape

export type StorageMeteringRecord = Omit<StorageMeteringRowShape, 'id'>

const mimeToAssetType = new Map<string, MediaAssetRecord['assetType']>([
  ['application/pdf', 'document'],
  ['application/zip', 'document'],
  ['application/x-zip-compressed', 'document'],
  ['application/msword', 'document'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
  ['text/plain', 'document'],
  ['text/csv', 'document'],
  ['application/json', 'document'],
  ['application/octet-stream', 'document']
])

export const deriveAssetType = (mimeType: string): MediaAssetRecord['assetType'] => {
  if (!mimeType) {return 'document'}

  const exact = mimeToAssetType.get(mimeType)
  if (exact) {return exact}

  if (mimeType.startsWith('image/gif')) {return 'gif'}
  if (mimeType.startsWith('image/')) {return 'image'}
  if (mimeType.startsWith('video/')) {return 'video'}
  if (mimeType.startsWith('audio/')) {return 'audio'}
  return 'document'
}

export const sanitizeFilename = (filename: string): string =>
  filename.replaceAll(/[/\\]/g, '_').replaceAll('..', '_')

export const buildStoragePath = (teamId: string, assetId: string, filename: string): string =>
  `${teamId}/${assetId}_${sanitizeFilename(filename)}`

export const buildThumbnailPath = (teamId: string, assetId: string, filename: string): string =>
  `${teamId}/${assetId}_${sanitizeFilename(filename)}_thumb`

// ── Computed fields ─────────────────────────────────────────────────

export const displayName = (asset: MediaAssetRecord): string =>
  asset.aiTitle ?? asset.originalFilename

export const isProcessing = (asset: MediaAssetRecord): boolean =>
  asset.processingStatus === 'pending' || asset.processingStatus === 'processing'

export const aspectRatio = (asset: MediaAssetRecord): Option.Option<string> => {
  const data = asset.assetTypeData
  if (!data || !('width' in data) || !('height' in data) || !data.width || !data.height) {
    return Option.none()
  }
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const d = gcd(data.width, data.height)
  return Option.some(`${data.width / d}:${data.height / d}`)
}

// ── Upload validation ───────────────────────────────────────────────

export type UploadValidationError =
  | { readonly code: 'EMPTY_FILENAME' }
  | { readonly code: 'INVALID_FILE_SIZE'; readonly actualBytes: number }
  | { readonly code: 'FILE_TOO_LARGE'; readonly maxBytes: number; readonly actualBytes: number }
  | { readonly code: 'UNSUPPORTED_TYPE'; readonly mimeType: string }

export interface ValidatedUploadResult {
  readonly filename: string
  readonly fileSize: number
  readonly assetType: MediaAssetRecord['assetType']
}

export const validateAssetUpload = (input: {
  fileName: string
  fileSize: number
  mimeType: string
}): Either.Either<ValidatedUploadResult, UploadValidationError> => {
  const filename = input.fileName.trim()
  if (filename.length === 0) {
    return Either.left({ code: 'EMPTY_FILENAME' })
  }
  if (!Number.isFinite(input.fileSize) || !Number.isInteger(input.fileSize) || input.fileSize <= 0) {
    return Either.left({ code: 'INVALID_FILE_SIZE', actualBytes: input.fileSize })
  }
  if (input.fileSize > 200 * 1024 * 1024) {
    return Either.left({ code: 'FILE_TOO_LARGE', maxBytes: 200 * 1024 * 1024, actualBytes: input.fileSize })
  }
  const assetType = deriveAssetType(input.mimeType)
  return Either.right({ filename, fileSize: input.fileSize, assetType })
}
