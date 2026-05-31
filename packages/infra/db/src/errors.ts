import { createLogger } from '@tx-agent-kit/logging'
import * as Schema from 'effect/Schema'

const dbLogger = createLogger('tx-agent-kit-db')

export class DbError extends Schema.TaggedError<DbError>()('DbError', {
  code: Schema.String,
  constraint: Schema.optional(Schema.String),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
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

const invitationOrgwidePendingUniqueConstraints = new Set([
  'invitations_org_email_orgwide_pending_unique'
])

const invitationTeamPendingUniqueConstraints = new Set([
  'invitations_org_email_team_pending_unique'
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

  if (constraint && invitationOrgwidePendingUniqueConstraints.has(constraint)) {
    return 'DB_INVITATION_ORGWIDE_PENDING_UNIQUE_VIOLATION'
  }

  if (constraint && invitationTeamPendingUniqueConstraints.has(constraint)) {
    return 'DB_INVITATION_TEAM_PENDING_UNIQUE_VIOLATION'
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

// Class-40 (Transaction Rollback) errors that Postgres guarantees have rolled
// back the transaction — so retrying the operation is safe (no partial commit)
// and is the documented, intended response to contention:
//   40001 serialization_failure   (SERIALIZABLE/REPEATABLE READ conflict)
//   40P01 deadlock_detected
// We deliberately do NOT include connection-level errors here: a dropped
// connection after a write has ambiguous commit state, so blind retry could
// double-apply a non-idempotent write.
const transientRollbackCodes = new Set(['40001', '40P01'])

/**
 * True when `error` (anywhere in its cause chain) is a Postgres transient
 * rollback error that is safe to retry verbatim. Used by the repository seam
 * (`withDb`) to self-heal contention-induced failures before they surface.
 */
export const isTransientPostgresError = (error: unknown): boolean => {
  const code = extractPostgresError(error)?.code
  return typeof code === 'string' && transientRollbackCodes.has(code)
}

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
    message: `${context}: ${toErrorMessage(cause)}`,
    cause
  })

export const dbDecodeFailed = (context: string, cause: unknown): DbError =>
  new DbError({
    code: 'DB_DECODE_FAILED',
    message: `${context}: ${toErrorMessage(cause)}`,
    cause
  })

export const toDbError = (context: string, cause: unknown): DbError => {
  if (cause instanceof DbError) {
    return cause
  }

  if (typeof cause === 'object' && cause !== null) {
    const pgError = extractPostgresError(cause)
    if (pgError) {
      const code = typeof pgError.code === 'string' ? pgError.code : ''
      const constraint = typeof pgError.constraint === 'string' ? pgError.constraint : ''
      dbLogger.error(context, { pgCode: code, constraint, pgMessage: toErrorMessage(pgError) })
    } else {
      const tag = (cause as { _tag?: string })._tag
      dbLogger.error(context, { errorType: tag ?? 'unknown', detail: toErrorMessage(cause) })
    }
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
