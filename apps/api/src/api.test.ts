import { describe, expect, it } from 'vitest'
import { mapCoreError } from './api.js'

describe('api error mapping', () => {
  it('maps core unauthorized to api unauthorized', () => {
    const error = mapCoreError({ _tag: 'CoreError', code: 'UNAUTHORIZED', message: 'nope' })
    expect(error._tag).toBe('Unauthorized')
  })

  it('reclassified infra failures (internalError) map to 500, never a silent 4xx', () => {
    // Observability regression guard (backport upstream e5d148b90/f18172c41):
    // transient repository/port failures are now classified as internalError
    // (INTERNAL_ERROR / 500) by the service layer instead of a silent
    // badRequest (400). At the API boundary they MUST map to InternalError so
    // they are logged at error level and surfaced as the 500 they are — never
    // swallowed as a client error.
    const mapped = mapCoreError({
      _tag: 'CoreError',
      code: 'INTERNAL_ERROR',
      message: 'Failed to process forgot-password request',
      cause: { _tag: 'DbError', code: 'DB_QUERY_FAILED', message: 'connection terminated unexpectedly' }
    })

    expect(mapped._tag).toBe('InternalError')
  })
})
