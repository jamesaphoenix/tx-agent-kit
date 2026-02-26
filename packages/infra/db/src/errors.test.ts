import { describe, expect, it } from 'vitest'
import { toDbError } from './errors.js'

describe('db errors', () => {
  it('maps nested users email unique violations to a specific db error code', () => {
    const error = toDbError('Failed to create user', {
      cause: {
        error: {
          code: '23505',
          constraint: 'users_email_ci_unique',
          message: 'duplicate key value violates unique constraint "users_email_ci_unique"'
        }
      }
    })

    expect(error.code).toBe('DB_USER_EMAIL_UNIQUE_VIOLATION')
    expect(error.constraint).toBe('users_email_ci_unique')
    expect(error.message).toContain('Failed to create user')
  })

  it('maps unknown unique violations to the generic unique code and captures constraint metadata', () => {
    const error = toDbError('Failed to create record', {
      code: '23505',
      constraint: 'organizations_name_unique',
      message: 'duplicate key value violates unique constraint "organizations_name_unique"'
    })

    expect(error.code).toBe('DB_UNIQUE_VIOLATION')
    expect(error.constraint).toBe('organizations_name_unique')
    expect(error.message).toContain('organizations_name_unique')
  })

  it('maps auth login identity unique violations to a specific db error code', () => {
    const error = toDbError('Failed to link auth identity', {
      code: '23505',
      constraint: 'auth_login_identities_provider_subject_unique',
      message: 'duplicate key value violates unique constraint "auth_login_identities_provider_subject_unique"'
    })

    expect(error.code).toBe('DB_AUTH_LOGIN_IDENTITY_UNIQUE_VIOLATION')
    expect(error.constraint).toBe('auth_login_identities_provider_subject_unique')
    expect(error.message).toContain('auth_login_identities_provider_subject_unique')
  })

  it('falls back to query-failed for non-unique postgres errors', () => {
    const error = toDbError('Failed to create record', {
      code: '22001',
      message: 'value too long for type character varying(20)'
    })

    expect(error.code).toBe('DB_QUERY_FAILED')
    expect(error.constraint).toBeUndefined()
  })
})
