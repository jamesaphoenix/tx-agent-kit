import * as Schema from 'effect/Schema'

export class DbError extends Schema.TaggedError<DbError>()('DbError', {
  code: Schema.String,
  constraint: Schema.optional(Schema.String),
  message: Schema.String
}) {}

interface PostgresErrorLike {
  code?: unknown
  constraint?: unknown
  message?: unknown
  cause?: unknown
  error?: unknown
}

const userEmailUniqueConstraints = new Set([
  'users_email_ci_unique',
  'users_email_key'
])

const authLoginIdentityUniqueConstraints = new Set([
  'auth_login_identities_provider_subject_unique',
  'auth_login_identities_user_provider_unique'
])

const getConstraintName = (error: PostgresErrorLike | null): string | undefined =>
  typeof error?.constraint === 'string' && error.constraint.length > 0
    ? error.constraint
    : undefined

const getUniqueViolationCode = (constraint: string | undefined): string => {
  if (constraint && userEmailUniqueConstraints.has(constraint)) {
    return 'DB_USER_EMAIL_UNIQUE_VIOLATION'
  }

  if (constraint && authLoginIdentityUniqueConstraints.has(constraint)) {
    return 'DB_AUTH_LOGIN_IDENTITY_UNIQUE_VIOLATION'
  }

  return 'DB_UNIQUE_VIOLATION'
}

const extractPostgresError = (
  error: unknown,
  depth = 0
): PostgresErrorLike | null => {
  if (depth > 4 || typeof error !== 'object' || error === null) {
    return null
  }

  const candidate = error as PostgresErrorLike
  if (typeof candidate.code === 'string') {
    return candidate
  }

  if (candidate.cause) {
    const nestedCause = extractPostgresError(candidate.cause, depth + 1)
    if (nestedCause) {
      return nestedCause
    }
  }

  if (candidate.error) {
    return extractPostgresError(candidate.error, depth + 1)
  }

  return null
}

const isPostgresUniqueViolation = (error: unknown): boolean =>
  extractPostgresError(error)?.code === '23505'

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }
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

  if (isPostgresUniqueViolation(cause)) {
    const pgError = extractPostgresError(cause)
    const constraintName = getConstraintName(pgError)
    const constraint = constraintName ? ` (${constraintName})` : ''

    return new DbError({
      code: getUniqueViolationCode(constraintName),
      constraint: constraintName,
      message: `${context}${constraint}: ${toErrorMessage(cause)}`
    })
  }

  return dbQueryFailed(context, cause)
}
