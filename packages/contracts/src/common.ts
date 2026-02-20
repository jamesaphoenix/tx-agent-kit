import * as Schema from 'effect/Schema'

export const emailSchema = Schema.String.pipe(
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
)

export const apiErrorSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
  requestId: Schema.String
})

export type ApiError = Schema.Schema.Type<typeof apiErrorSchema>
