import * as Schema from 'effect/Schema'

export class StorageError extends Schema.TaggedError<StorageError>()('StorageError', {
  code: Schema.String,
  message: Schema.String
}) {}
