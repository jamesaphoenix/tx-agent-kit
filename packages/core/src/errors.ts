import * as Data from 'effect/Data'
import * as Schema from 'effect/Schema'

export class CoreError extends Schema.TaggedError<CoreError>()('CoreError', {
  message: Schema.String,
  code: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export class UsageCapExceeded extends Data.TaggedError('UsageCapExceeded')<{
  readonly scope: 'organization' | 'campaign'
  readonly message: string
}> {}

export const unauthorized = (message = 'Unauthorized', cause?: unknown): CoreError =>
  new CoreError({ message, code: 'UNAUTHORIZED', cause })

export const badRequest = (message: string, cause?: unknown): CoreError =>
  new CoreError({ message, code: 'BAD_REQUEST', cause })

export const notFound = (message: string, cause?: unknown): CoreError =>
  new CoreError({ message, code: 'NOT_FOUND', cause })

export const conflict = (message: string, cause?: unknown): CoreError =>
  new CoreError({ message, code: 'CONFLICT', cause })

export const forbidden = (message: string, cause?: unknown): CoreError =>
  new CoreError({ message, code: 'FORBIDDEN', cause })

export const paymentRequired = (message: string, cause?: unknown): CoreError =>
  new CoreError({ message, code: 'PAYMENT_REQUIRED', cause })

export const internalError = (message: string, cause?: unknown): CoreError =>
  new CoreError({ message, code: 'INTERNAL_ERROR', cause })
