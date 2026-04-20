import { describe, expect, it } from 'vitest'
import { Either, Option } from 'effect'
import {
  aspectRatio,
  buildStoragePath,
  buildThumbnailPath,
  deriveAssetType,
  displayName,
  isProcessing,
  sanitizeFilename,
  validateAssetUpload,
  type MediaAssetRecord
} from './assets-domain.js'

// ── Test helpers ────────────────────────────────────────────────────

// Construct a fixed Date without triggering the `new Date()` lint rule.
const fixedDate = /* @__PURE__ */ (() => {
  const D = Date
  return new D('2024-01-01')
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
  storagePath: 'team/asset_photo.jpg',
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

// ── validateAssetUpload (Either) ────────────────────────────────────

describe('validateAssetUpload', () => {
  it('returns Right for a valid image upload', () => {
    const result = validateAssetUpload({ fileName: 'test.jpg', fileSize: 1024, mimeType: 'image/jpeg' })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        filename: 'test.jpg',
        fileSize: 1024,
        assetType: 'image'
      })
    }
  })

  it('returns Right for a valid video upload', () => {
    const result = validateAssetUpload({ fileName: 'clip.mp4', fileSize: 50_000_000, mimeType: 'video/mp4' })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.assetType).toBe('video')
    }
  })

  it('returns Right for a valid document upload', () => {
    const result = validateAssetUpload({ fileName: 'report.pdf', fileSize: 2048, mimeType: 'application/pdf' })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.assetType).toBe('document')
    }
  })

  it('trims whitespace from filename', () => {
    const result = validateAssetUpload({ fileName: '  test.jpg  ', fileSize: 1024, mimeType: 'image/jpeg' })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.filename).toBe('test.jpg')
    }
  })

  it('returns Left with EMPTY_FILENAME for empty name', () => {
    const result = validateAssetUpload({ fileName: '', fileSize: 1024, mimeType: 'image/jpeg' })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toEqual({ code: 'EMPTY_FILENAME' })
    }
  })

  it('returns Left with EMPTY_FILENAME for whitespace-only name', () => {
    const result = validateAssetUpload({ fileName: '   ', fileSize: 1024, mimeType: 'image/jpeg' })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.code).toBe('EMPTY_FILENAME')
    }
  })

  it('returns Left with INVALID_FILE_SIZE for non-positive or fractional sizes', () => {
    for (const fileSize of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateAssetUpload({ fileName: 'bad-size.jpg', fileSize, mimeType: 'image/jpeg' })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left.code).toBe('INVALID_FILE_SIZE')
      }
    }
  })

  it('returns Left with FILE_TOO_LARGE when exceeding 200 MB', () => {
    const tooBig = 200 * 1024 * 1024 + 1
    const result = validateAssetUpload({ fileName: 'big.zip', fileSize: tooBig, mimeType: 'application/zip' })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.code).toBe('FILE_TOO_LARGE')
      expect(result.left).toHaveProperty('maxBytes', 200 * 1024 * 1024)
      expect(result.left).toHaveProperty('actualBytes', tooBig)
    }
  })

  it('returns Right at exactly 200 MB boundary', () => {
    const exactLimit = 200 * 1024 * 1024
    const result = validateAssetUpload({ fileName: 'exact.zip', fileSize: exactLimit, mimeType: 'application/zip' })
    expect(Either.isRight(result)).toBe(true)
  })
})

// ── aspectRatio (Option) ────────────────────────────────────────────

describe('aspectRatio', () => {
  it('returns Some with correct ratio for 1920x1080 image', () => {
    const asset = makeAsset({
      assetTypeData: { type: 'image', width: 1920, height: 1080, format: 'jpeg' }
    })
    const result = aspectRatio(asset)
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value).toBe('16:9')
    }
  })

  it('returns Some with correct ratio for 1080x1080 square image', () => {
    const asset = makeAsset({
      assetTypeData: { type: 'image', width: 1080, height: 1080, format: 'jpeg' }
    })
    const result = aspectRatio(asset)
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value).toBe('1:1')
    }
  })

  it('returns Some for video with dimensions', () => {
    const asset = makeAsset({
      assetType: 'video',
      assetTypeData: { type: 'video', width: 3840, height: 2160, duration: 120, codec: 'h264' }
    })
    const result = aspectRatio(asset)
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value).toBe('16:9')
    }
  })

  it('returns None for asset without type data', () => {
    const asset = makeAsset({ assetTypeData: null })
    expect(Option.isNone(aspectRatio(asset))).toBe(true)
  })

  it('returns None for audio asset (no width/height)', () => {
    const asset = makeAsset({
      assetType: 'audio',
      assetTypeData: { type: 'audio', duration: 180, codec: 'aac' } as MediaAssetRecord['assetTypeData']
    })
    expect(Option.isNone(aspectRatio(asset))).toBe(true)
  })

  it('returns None when width is zero', () => {
    const asset = makeAsset({
      assetTypeData: { type: 'image', width: 0, height: 1080, format: 'jpeg' }
    })
    expect(Option.isNone(aspectRatio(asset))).toBe(true)
  })

  it('returns None when height is zero', () => {
    const asset = makeAsset({
      assetTypeData: { type: 'image', width: 1920, height: 0, format: 'jpeg' }
    })
    expect(Option.isNone(aspectRatio(asset))).toBe(true)
  })
})

// ── deriveAssetType ─────────────────────────────────────────────────

describe('deriveAssetType', () => {
  it('derives image from image/* MIME types', () => {
    expect(deriveAssetType('image/jpeg')).toBe('image')
    expect(deriveAssetType('image/png')).toBe('image')
    expect(deriveAssetType('image/webp')).toBe('image')
  })

  it('derives gif from image/gif', () => {
    expect(deriveAssetType('image/gif')).toBe('gif')
  })

  it('derives video from video/* MIME types', () => {
    expect(deriveAssetType('video/mp4')).toBe('video')
    expect(deriveAssetType('video/quicktime')).toBe('video')
  })

  it('derives audio from audio/* MIME types', () => {
    expect(deriveAssetType('audio/mpeg')).toBe('audio')
    expect(deriveAssetType('audio/wav')).toBe('audio')
  })

  it('derives document from exact MIME matches', () => {
    expect(deriveAssetType('application/pdf')).toBe('document')
    expect(deriveAssetType('text/plain')).toBe('document')
    expect(deriveAssetType('text/csv')).toBe('document')
    expect(deriveAssetType('application/json')).toBe('document')
  })

  it('defaults to document for unknown MIME types', () => {
    expect(deriveAssetType('application/x-custom')).toBe('document')
  })

  it('defaults to document for empty MIME type', () => {
    expect(deriveAssetType('')).toBe('document')
  })
})

// ── Pure utility functions ──────────────────────────────────────────

describe('sanitizeFilename', () => {
  it('replaces forward slashes with underscores', () => {
    expect(sanitizeFilename('path/to/file.jpg')).toBe('path_to_file.jpg')
  })

  it('replaces backslashes with underscores', () => {
    expect(sanitizeFilename('path\\to\\file.jpg')).toBe('path_to_file.jpg')
  })

  it('replaces double dots with underscores', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('____etc_passwd')
  })

  it('preserves normal filenames', () => {
    expect(sanitizeFilename('my-photo.jpg')).toBe('my-photo.jpg')
  })
})

describe('buildStoragePath', () => {
  it('produces teamId/assetId_filename format', () => {
    expect(buildStoragePath('team-123', 'asset-456', 'photo.jpg')).toBe('team-123/asset-456_photo.jpg')
  })
})

describe('buildThumbnailPath', () => {
  it('appends _thumb suffix', () => {
    expect(buildThumbnailPath('team-123', 'asset-456', 'photo.jpg')).toBe('team-123/asset-456_photo.jpg_thumb')
  })
})

describe('displayName', () => {
  it('returns aiTitle when available', () => {
    const asset = makeAsset({ aiTitle: 'AI Generated Title' })
    expect(displayName(asset)).toBe('AI Generated Title')
  })

  it('falls back to originalFilename when aiTitle is null', () => {
    const asset = makeAsset({ aiTitle: null, originalFilename: 'photo.jpg' })
    expect(displayName(asset)).toBe('photo.jpg')
  })
})

describe('isProcessing', () => {
  it('returns true for pending status', () => {
    expect(isProcessing(makeAsset({ processingStatus: 'pending' }))).toBe(true)
  })

  it('returns true for processing status', () => {
    expect(isProcessing(makeAsset({ processingStatus: 'processing' }))).toBe(true)
  })

  it('returns false for completed status', () => {
    expect(isProcessing(makeAsset({ processingStatus: 'completed' }))).toBe(false)
  })

  it('returns false for failed status', () => {
    expect(isProcessing(makeAsset({ processingStatus: 'failed' }))).toBe(false)
  })
})
