import { describe, it, expect, afterAll } from 'vitest'
import { Effect } from 'effect'
import { Storage, StorageLive } from './client.js'

process.env.TX_STORAGE_MODE ??= 'memory'

const textEncoder = new TextEncoder()
const testPrefix = `integration-test-${Date.now()}/`
const uploadedKeys: string[] = []

const runStorage = <A>(effect: Effect.Effect<A, unknown, Storage>) =>
  Effect.runPromise(effect.pipe(Effect.provide(StorageLive)))

const isMemoryUrl = (url: string): boolean => url.startsWith('memory://')

const uploadViaGeneratedUrl = (key: string, body: string) =>
  runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage
      const uploadUrl = yield* storage.generateUploadUrl(key, 'text/plain')
      if (isMemoryUrl(uploadUrl)) {
        yield* storage.putObject(key, textEncoder.encode(body), 'text/plain')
        return
      }

      const response = yield* Effect.promise(() =>
        fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body
        })
      )
      expect(response.ok).toBe(true)
    })
  )

const downloadViaGeneratedUrl = (key: string) =>
  runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage
      const downloadUrl = yield* storage.generateDownloadUrl(key)
      if (isMemoryUrl(downloadUrl)) {
        return new TextDecoder().decode(yield* storage.getObject(key))
      }

      const response = yield* Effect.promise(() => fetch(downloadUrl))
      expect(response.ok).toBe(true)
      return yield* Effect.promise(() => response.text())
    })
  )

afterAll(async () => {
  for (const key of uploadedKeys) {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        yield* storage.deleteObject(key)
      })
    )
  }
})

describe('R2 Storage Integration', () => {
  it('generates a presigned upload URL', async () => {
    const key = `${testPrefix}upload-test.txt`
    uploadedKeys.push(key)

    const url = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        return yield* storage.generateUploadUrl(key, 'text/plain', 300)
      })
    )

    expect(isMemoryUrl(url) || url.includes('X-Amz-Signature')).toBe(true)
    await uploadViaGeneratedUrl(key, 'hello from integration test')
  })

  it('generates a presigned download URL for an uploaded object', async () => {
    const key = `${testPrefix}download-test.txt`
    uploadedKeys.push(key)

    await uploadViaGeneratedUrl(key, 'download me')

    const text = await downloadViaGeneratedUrl(key)
    expect(text).toBe('download me')
  })

  it('lists objects with a prefix', async () => {
    const key = `${testPrefix}list-test.txt`
    uploadedKeys.push(key)

    await uploadViaGeneratedUrl(key, 'list me')

    const keys = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        return yield* storage.listObjects(testPrefix)
      })
    )

    expect(keys).toContain(key)
  })

  it('gets object metadata', async () => {
    const key = `${testPrefix}metadata-test.txt`
    uploadedKeys.push(key)

    await uploadViaGeneratedUrl(key, 'metadata test content')

    const metadata = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        return yield* storage.getObjectMetadata(key)
      })
    )

    expect(metadata.key).toBe(key)
    expect(metadata.contentLength).toBeGreaterThan(0)
    expect(metadata.etag).toBeDefined()
  })

  it('deletes an object', async () => {
    const key = `${testPrefix}delete-test.txt`

    await uploadViaGeneratedUrl(key, 'delete me')

    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        yield* storage.deleteObject(key)
      })
    )

    const keys = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        return yield* storage.listObjects(testPrefix + 'delete-test')
      })
    )

    expect(keys).not.toContain(key)
  })
})
