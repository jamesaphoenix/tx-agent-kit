import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Effect } from 'effect'

const mockSend = vi.fn()

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: function S3Client() {
      return { send: mockSend }
    },
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    ListObjectsV2Command: vi.fn(),
    HeadObjectCommand: vi.fn()
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://presigned-url.example.com')
}))

vi.mock('./env.js', () => ({
  getStorageEnv: () => ({
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_BUCKET_NAME: 'test-bucket',
    R2_ENDPOINT: 'https://test.endpoint.com'
  })
}))

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getService = async () => {
    const { Storage, StorageLive } = await import('./client.js')
    return Effect.runSync(
      Effect.gen(function* () {
        return yield* Storage
      }).pipe(Effect.provide(StorageLive))
    )
  }

  describe('generateUploadUrl', () => {
    it('returns a presigned URL', async () => {
      const service = await getService()
      const result = await Effect.runPromise(
        service.generateUploadUrl('test/file.png', 'image/png')
      )
      expect(result).toBe('https://presigned-url.example.com')
    })

    it('accepts custom expiry', async () => {
      const service = await getService()
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      await Effect.runPromise(
        service.generateUploadUrl('test/file.png', 'image/png', 7200)
      )
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 7200 }
      )
    })
  })

  describe('generateDownloadUrl', () => {
    it('returns a presigned URL', async () => {
      const service = await getService()
      const result = await Effect.runPromise(
        service.generateDownloadUrl('test/file.png')
      )
      expect(result).toBe('https://presigned-url.example.com')
    })
  })

  describe('deleteObject', () => {
    it('completes without error', async () => {
      mockSend.mockResolvedValueOnce({})
      const service = await getService()
      await Effect.runPromise(service.deleteObject('test/file.png'))
    })
  })

  describe('getObject', () => {
    it('returns object bytes', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () => Promise.resolve(bytes)
        }
      })

      const service = await getService()
      const result = await Effect.runPromise(service.getObject('test/file.png'))
      expect(result).toEqual(bytes)
    })
  })

  describe('listObjects', () => {
    it('returns object keys', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'test/file1.png' },
          { Key: 'test/file2.png' }
        ]
      })

      const service = await getService()
      const result = await Effect.runPromise(service.listObjects('test/'))
      expect(result).toEqual(['test/file1.png', 'test/file2.png'])
    })

    it('returns empty array when no contents', async () => {
      mockSend.mockResolvedValueOnce({ Contents: undefined })

      const service = await getService()
      const result = await Effect.runPromise(service.listObjects('empty/'))
      expect(result).toEqual([])
    })
  })

  describe('getObjectMetadata', () => {
    it('returns metadata', async () => {
      const lastModified = new Date('2026-01-01T00:00:00Z')
      mockSend.mockResolvedValueOnce({
        ContentType: 'image/png',
        ContentLength: 1024,
        LastModified: lastModified,
        ETag: '"abc123"'
      })

      const service = await getService()
      const result = await Effect.runPromise(
        service.getObjectMetadata('test/file.png')
      )
      expect(result).toEqual({
        key: 'test/file.png',
        contentType: 'image/png',
        contentLength: 1024,
        lastModified,
        etag: '"abc123"'
      })
    })
  })
})
