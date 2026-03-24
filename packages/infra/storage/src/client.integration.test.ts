import { describe, it, expect, afterAll } from 'vitest'
import { Effect } from 'effect'
import { Storage, StorageLive } from './client.js'

const testPrefix = `integration-test-${Date.now()}/`
const uploadedKeys: string[] = []

const runStorage = <A>(effect: Effect.Effect<A, unknown, Storage>) =>
  Effect.runPromise(effect.pipe(Effect.provide(StorageLive)))

const uploadViaPresignedUrl = (url: string, body: string) =>
  Effect.promise(() =>
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body
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

    expect(url).toContain('X-Amz-Signature')

    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello from integration test'
    })
    expect(response.ok).toBe(true)
  })

  it('generates a presigned download URL for an uploaded object', async () => {
    const key = `${testPrefix}download-test.txt`
    uploadedKeys.push(key)

    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        const uploadUrl = yield* storage.generateUploadUrl(key, 'text/plain')
        yield* uploadViaPresignedUrl(uploadUrl, 'download me')
      })
    )

    const downloadUrl = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        return yield* storage.generateDownloadUrl(key)
      })
    )

    const response = await fetch(downloadUrl)
    expect(response.ok).toBe(true)
    const text = await response.text()
    expect(text).toBe('download me')
  })

  it('lists objects with a prefix', async () => {
    const key = `${testPrefix}list-test.txt`
    uploadedKeys.push(key)

    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        const uploadUrl = yield* storage.generateUploadUrl(key, 'text/plain')
        yield* uploadViaPresignedUrl(uploadUrl, 'list me')
      })
    )

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

    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        const uploadUrl = yield* storage.generateUploadUrl(key, 'text/plain')
        yield* uploadViaPresignedUrl(uploadUrl, 'metadata test content')
      })
    )

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

    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage
        const uploadUrl = yield* storage.generateUploadUrl(key, 'text/plain')
        yield* uploadViaPresignedUrl(uploadUrl, 'delete me')
      })
    )

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
