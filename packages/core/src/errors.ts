import * as Schema from 'effect/Schema'

export class CoreError extends Schema.TaggedError<CoreError>()('CoreError', {
  message: Schema.String,
  code: Schema.String
}) {}

export const unauthorized = (message = 'Unauthorized'): CoreError =>
  new CoreError({ message, code: 'UNAUTHORIZED' })

export const badRequest = (message: string): CoreError =>
  new CoreError({ message, code: 'BAD_REQUEST' })

export const notFound = (message: string): CoreError =>
  new CoreError({ message, code: 'NOT_FOUND' })

export const conflict = (message: string): CoreError =>
  new CoreError({ message, code: 'CONFLICT' })
