import * as Schema from 'effect/Schema'

export class AiError extends Schema.TaggedError<AiError>()('AiError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}
