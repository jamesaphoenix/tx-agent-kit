import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Context, Effect, Layer } from 'effect'
import { getStorageEnv } from './env.js'
import { StorageError } from './errors.js'

const defaultPresignExpiresIn = 3600

export interface ObjectMetadata {
  key: string
  contentType: string | undefined
  contentLength: number | undefined
  lastModified: Date | undefined
  etag: string | undefined
}

export interface StorageService {
  generateUploadUrl(
    key: string,
    contentType: string,
    expiresIn?: number
  ): Effect.Effect<string, StorageError>

  generateDownloadUrl(
    key: string,
    expiresIn?: number
  ): Effect.Effect<string, StorageError>

  deleteObject(key: string): Effect.Effect<void, StorageError>

  listObjects(prefix?: string): Effect.Effect<readonly string[], StorageError>

  getObjectMetadata(key: string): Effect.Effect<ObjectMetadata, StorageError>
}

export class Storage extends Context.Tag('@tx-agent-kit/storage/Storage')<
  Storage,
  StorageService
>() {}

const makeStorageService = (): StorageService => {
  const env = getStorageEnv()

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
  })

  const bucket = env.R2_BUCKET_NAME

  return {
    generateUploadUrl: (key, contentType, expiresIn) =>
      Effect.tryPromise({
        try: () =>
          getSignedUrl(
            s3Client,
            new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
            { expiresIn: expiresIn ?? defaultPresignExpiresIn }
          ),
        catch: (cause) =>
          new StorageError({
            code: 'STORAGE_PRESIGN_UPLOAD_FAILED',
            message: `Failed to generate upload URL for ${key}: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      }),

    generateDownloadUrl: (key, expiresIn) =>
      Effect.tryPromise({
        try: () =>
          getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: expiresIn ?? defaultPresignExpiresIn }
          ),
        catch: (cause) =>
          new StorageError({
            code: 'STORAGE_PRESIGN_DOWNLOAD_FAILED',
            message: `Failed to generate download URL for ${key}: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      }),

    deleteObject: (key) =>
      Effect.tryPromise({
        try: async () => {
          await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        },
        catch: (cause) =>
          new StorageError({
            code: 'STORAGE_DELETE_FAILED',
            message: `Failed to delete ${key}: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      }),

    listObjects: (prefix) =>
      Effect.tryPromise({
        try: async () => {
          const response = await s3Client.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
          )
          return (response.Contents ?? [])
            .map((item) => item.Key)
            .filter((key): key is string => typeof key === 'string')
        },
        catch: (cause) =>
          new StorageError({
            code: 'STORAGE_LIST_FAILED',
            message: `Failed to list objects with prefix ${prefix ?? '(none)'}: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      }),

    getObjectMetadata: (key) =>
      Effect.tryPromise({
        try: async () => {
          const response = await s3Client.send(
            new HeadObjectCommand({ Bucket: bucket, Key: key })
          )
          return {
            key,
            contentType: response.ContentType,
            contentLength: response.ContentLength,
            lastModified: response.LastModified,
            etag: response.ETag
          }
        },
        catch: (cause) =>
          new StorageError({
            code: 'STORAGE_METADATA_FAILED',
            message: `Failed to get metadata for ${key}: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      })
  }
}

export const StorageLive = Layer.effect(
  Storage,
  Effect.sync(() => makeStorageService())
)
