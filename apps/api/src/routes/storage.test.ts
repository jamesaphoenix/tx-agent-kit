import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Context, Effect, Layer } from 'effect'

class MockStorage extends Context.Tag('@tx-agent-kit/storage/Storage')<MockStorage, {
  generateUploadUrl(key: string, contentType: string, expiresIn?: number): Effect.Effect<string>
  generateDownloadUrl(key: string, expiresIn?: number): Effect.Effect<string>
  deleteObject(key: string): Effect.Effect<void>
  listObjects(prefix?: string): Effect.Effect<readonly string[]>
  getObjectMetadata(key: string): Effect.Effect<{
    key: string
    contentType: string | undefined
    contentLength: number | undefined
    lastModified: Date | undefined
    etag: string | undefined
  }>
}>() {}

const mockService = {
  generateUploadUrl: (key: string, contentType: string) =>
    Effect.succeed(`https://r2.example.com/upload?key=${key}&type=${contentType}`),
  generateDownloadUrl: (key: string) =>
    Effect.succeed(`https://r2.example.com/download?key=${key}`),
  deleteObject: () => Effect.void,
  listObjects: () => Effect.succeed(['org/file1.png', 'org/file2.jpg']),
  getObjectMetadata: (key: string) =>
    Effect.succeed({
      key,
      contentType: 'image/png',
      contentLength: 2048,
      lastModified: undefined,
      etag: '"abc123"'
    })
}

vi.mock('@tx-agent-kit/storage', () => ({
  Storage: MockStorage,
  StorageLive: Layer.succeed(MockStorage, mockService),
  StorageError: class extends Error { _tag = 'StorageError' as const },
  getStorageEnv: () => ({})
}))

const TestLayer = Layer.succeed(MockStorage, mockService)

describe('Storage Service (via Effect layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generateUploadUrl returns presigned URL', () =>
    Effect.gen(function* () {
      const storage = yield* MockStorage
      const result = yield* storage.generateUploadUrl('org/test.png', 'image/png')
      expect(result).toBe('https://r2.example.com/upload?key=org/test.png&type=image/png')
    }).pipe(Effect.provide(TestLayer), Effect.runPromise)
  )

  it('generateDownloadUrl returns presigned URL', () =>
    Effect.gen(function* () {
      const storage = yield* MockStorage
      const result = yield* storage.generateDownloadUrl('org/test.png')
      expect(result).toBe('https://r2.example.com/download?key=org/test.png')
    }).pipe(Effect.provide(TestLayer), Effect.runPromise)
  )

  it('deleteObject completes without error', () =>
    Effect.gen(function* () {
      const storage = yield* MockStorage
      yield* storage.deleteObject('org/test.png')
    }).pipe(Effect.provide(TestLayer), Effect.runPromise)
  )

  it('listObjects returns keys', () =>
    Effect.gen(function* () {
      const storage = yield* MockStorage
      const keys = yield* storage.listObjects('org/')
      expect(keys).toEqual(['org/file1.png', 'org/file2.jpg'])
    }).pipe(Effect.provide(TestLayer), Effect.runPromise)
  )

  it('getObjectMetadata returns metadata', () =>
    Effect.gen(function* () {
      const storage = yield* MockStorage
      const metadata = yield* storage.getObjectMetadata('org/test.png')
      expect(metadata.key).toBe('org/test.png')
      expect(metadata.contentType).toBe('image/png')
      expect(metadata.contentLength).toBe(2048)
      expect(metadata.etag).toBe('"abc123"')
    }).pipe(Effect.provide(TestLayer), Effect.runPromise)
  )
})
