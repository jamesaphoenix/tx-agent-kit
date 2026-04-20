import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Context, Effect, Layer } from 'effect'

class MockStorage extends Context.Tag('@tx-agent-kit/storage/Storage')<
  MockStorage,
  {
    generateUploadUrl(key: string, contentType: string, expiresIn?: number): Effect.Effect<string>
    generateDownloadUrl(key: string, expiresIn?: number): Effect.Effect<string>
    putObject(key: string, body: Uint8Array, contentType: string): Effect.Effect<void>
    getObject(key: string): Effect.Effect<Uint8Array>
    deleteObject(key: string): Effect.Effect<void>
    listObjects(prefix?: string): Effect.Effect<readonly string[]>
    getObjectMetadata(key: string): Effect.Effect<{
      key: string
      contentType: string | undefined
      contentLength: number | undefined
      lastModified: Date | undefined
      etag: string | undefined
    }>
  }
>() {}

vi.mock('@tx-agent-kit/storage', () => {
  const mockService = {
    generateUploadUrl: () => Effect.succeed('https://mock-upload-url.com'),
    generateDownloadUrl: () => Effect.succeed('https://mock-download-url.com'),
    putObject: () => Effect.void,
    getObject: () => Effect.succeed(new Uint8Array([1, 2, 3])),
    deleteObject: () => Effect.void,
    listObjects: (prefix: string | undefined) =>
      Effect.succeed(prefix === 'test/' ? ['test/file1.png', 'test/file2.png'] : []),
    getObjectMetadata: (key: string) =>
      Effect.succeed({
        key,
        contentType: 'image/png',
        contentLength: 1024,
        lastModified: new Date(),
        etag: '"mock"'
      })
  }

  return {
    Storage: MockStorage,
    StorageLive: Layer.succeed(MockStorage, mockService),
    StorageError: class extends Error { _tag = 'StorageError' as const },
    getStorageEnv: () => ({})
  }
})

vi.mock('@tx-agent-kit/db', () => ({
  domainEventsRepository: {
    fetchUnprocessed: () => Effect.succeed([]),
    markPublished: () => Effect.succeed({ updated: 0 }),
    markFailed: () => Effect.succeed({ updated: 0 }),
    resetStuckProcessing: () => Effect.succeed([]),
    prunePublished: () => Effect.succeed({ deleted: 0 })
  }
}))

vi.mock('@tx-agent-kit/logging', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  })
}))

vi.mock('./config/env.js', () => ({
  getWorkerEnv: () => ({
    TEMPORAL_RUNTIME_MODE: 'cli',
    TEMPORAL_ADDRESS: 'localhost:7233',
    TEMPORAL_NAMESPACE: 'default',
    TEMPORAL_TASK_QUEUE: 'test',
    NODE_ENV: 'test'
  })
}))

describe('storageActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deleteStorageObjects deletes objects and reports results', async () => {
    const { storageActivities } = await import('./activities.js')

    const result = await storageActivities.deleteStorageObjects([
      'test/file1.png',
      'test/file2.png'
    ])

    expect(result.deleted).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('listStorageObjects returns keys for prefix', async () => {
    const { storageActivities } = await import('./activities.js')

    const keys = await storageActivities.listStorageObjects('test/')

    expect(keys).toEqual(['test/file1.png', 'test/file2.png'])
  })

  it('listStorageObjects returns empty for unknown prefix', async () => {
    const { storageActivities } = await import('./activities.js')

    const keys = await storageActivities.listStorageObjects('unknown/')

    expect(keys).toEqual([])
  })
})
