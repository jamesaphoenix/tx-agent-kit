import * as Schema from 'effect/Schema'

export const generateUploadUrlBodySchema = Schema.Struct({
  key: Schema.String.pipe(Schema.minLength(1)),
  contentType: Schema.String.pipe(Schema.minLength(1)),
  expiresIn: Schema.optional(Schema.Number)
})

export const generateDownloadUrlBodySchema = Schema.Struct({
  key: Schema.String.pipe(Schema.minLength(1)),
  expiresIn: Schema.optional(Schema.Number)
})

export const deleteObjectBodySchema = Schema.Struct({
  key: Schema.String.pipe(Schema.minLength(1))
})

export const listObjectsParamsSchema = Schema.Struct({
  prefix: Schema.optional(Schema.String)
})

export const presignedUrlResponseSchema = Schema.Struct({
  url: Schema.String
})

export const listObjectsResponseSchema = Schema.Struct({
  keys: Schema.Array(Schema.String)
})

export const objectMetadataResponseSchema = Schema.Struct({
  key: Schema.String,
  contentType: Schema.NullOr(Schema.String),
  contentLength: Schema.NullOr(Schema.Number),
  lastModified: Schema.NullOr(Schema.String),
  etag: Schema.NullOr(Schema.String)
})

export type GenerateUploadUrlBody = Schema.Schema.Type<typeof generateUploadUrlBodySchema>
export type GenerateDownloadUrlBody = Schema.Schema.Type<typeof generateDownloadUrlBodySchema>
export type DeleteObjectBody = Schema.Schema.Type<typeof deleteObjectBodySchema>
export type ListObjectsParams = Schema.Schema.Type<typeof listObjectsParamsSchema>
export type PresignedUrlResponse = Schema.Schema.Type<typeof presignedUrlResponseSchema>
export type ListObjectsResponse = Schema.Schema.Type<typeof listObjectsResponseSchema>
export type ObjectMetadataResponse = Schema.Schema.Type<typeof objectMetadataResponseSchema>
