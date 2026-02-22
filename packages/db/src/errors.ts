import * as Schema from 'effect/Schema'

export class DbError extends Schema.TaggedError<DbError>()('DbError', {
  code: Schema.String,
  message: Schema.String
}) {}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export const dbQueryFailed = (context: string, cause: unknown): DbError =>
  new DbError({
    code: 'DB_QUERY_FAILED',
    message: `${context}: ${toErrorMessage(cause)}`
  })

export const dbDecodeFailed = (context: string, cause: unknown): DbError =>
  new DbError({
    code: 'DB_DECODE_FAILED',
    message: `${context}: ${toErrorMessage(cause)}`
  })

export const toDbError = (context: string, cause: unknown): DbError => {
  if (cause instanceof DbError) {
    return cause
  }

  return dbQueryFailed(context, cause)
}
