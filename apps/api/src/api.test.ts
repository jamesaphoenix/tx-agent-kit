import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('@tx-agent-kit/logging')
  vi.doUnmock('./observability/sentry.js')
})

const importApi = async () => import('./api.js')

describe('api error mapping', () => {
  it('maps core unauthorized to api unauthorized', async () => {
    const { mapCoreError } = await importApi()
    const error = mapCoreError({ _tag: 'CoreError', code: 'UNAUTHORIZED', message: 'nope' })
    expect(error._tag).toBe('Unauthorized')
  })

  it('reclassified infra failures (internalError) map to 500, never a silent 4xx', async () => {
    // Observability regression guard (backport upstream e5d148b90/f18172c41):
    // transient repository/port failures are now classified as internalError
    // (INTERNAL_ERROR / 500) by the service layer instead of a silent
    // badRequest (400). At the API boundary they MUST map to InternalError so
    // they are logged at error level and surfaced as the 500 they are — never
    // swallowed as a client error.
    const { mapCoreError } = await importApi()
    const mapped = mapCoreError({
      _tag: 'CoreError',
      code: 'INTERNAL_ERROR',
      message: 'Failed to process forgot-password request',
      cause: { _tag: 'DbError', code: 'DB_QUERY_FAILED', message: 'connection terminated unexpectedly' }
    })

    expect(mapped._tag).toBe('InternalError')
  })

  it('does not capture expected expired session tokens to Sentry', async () => {
    const infoLog = vi.fn<(message: string, context?: Record<string, unknown>) => void>()
    const warnLog = vi.fn<(message: string, context?: Record<string, unknown>) => void>()
    const captureApiMappedError = vi.fn()
    const childLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: infoLog,
      warn: warnLog,
      child: vi.fn()
    }
    const rootLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: infoLog,
      warn: warnLog,
      child: vi.fn(() => childLogger)
    }

    vi.doMock('@tx-agent-kit/logging', () => ({
      createLogger: vi.fn(() => rootLogger)
    }))
    vi.doMock('./observability/sentry.js', () => ({
      _resetApiSentryForTest: vi.fn(),
      captureApiException: vi.fn(),
      captureApiMappedError,
      flushApiSentry: vi.fn(),
      initializeApiSentry: vi.fn()
    }))

    const jwtExpired = new Error('"exp" claim timestamp check failed') as Error & {
      cause?: unknown
    }
    jwtExpired.name = 'JWTExpired'
    jwtExpired.cause = {
      claim: 'exp',
      reason: 'check_failed',
      payload: {
        email: 'user@example.com',
        sid: '19bce95d-7fa9-48a5-83ad-19149e983f57',
        sub: '39d9e705-f38f-40b5-9419-76fd0c55b336',
        exp: 1
      }
    }
    const authFailure = new Error('Invalid session token') as Error & { cause?: unknown }
    authFailure.name = 'AuthError'
    authFailure.cause = jwtExpired

    const { mapCoreError } = await importApi()
    const mapped = mapCoreError({
      _tag: 'CoreError',
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      cause: authFailure
    })

    expect(mapped._tag).toBe('Unauthorized')
    // An expected token expiry is logged at info, not warn, and never sent to Sentry.
    expect(infoLog).toHaveBeenCalledWith(
      '"exp" claim timestamp check failed',
      expect.objectContaining({
        code: 'UNAUTHORIZED',
        rootCauseTag: 'JWTExpired',
        rootCauseMessage: '"exp" claim timestamp check failed'
      })
    )
    expect(warnLog).not.toHaveBeenCalled()
    const infoLogContext = infoLog.mock.calls[0]?.[1]
    const causeChain = infoLogContext?.causeChain
    const isCauseChain = (value: unknown): value is ReadonlyArray<{ readonly message?: string }> =>
      Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null)
    expect(isCauseChain(causeChain)).toBe(true)
    if (!isCauseChain(causeChain)) {
      throw new Error('Expected info log context to include a cause chain')
    }
    expect(
      causeChain.some(
        (item) => item.message === '{"claim":"exp","reason":"check_failed","payload":"[REDACTED]"}'
      )
    ).toBe(true)
    // The decoded claim payload carries PII (email/sub/sid); it must never leak.
    const infoLogCalls = JSON.stringify(infoLog.mock.calls)
    expect(infoLogCalls).not.toContain('user@example.com')
    expect(infoLogCalls).not.toContain('19bce95d-7fa9-48a5-83ad-19149e983f57')
    expect(captureApiMappedError).not.toHaveBeenCalled()
  })

  it('still captures unexpected unauthorized operational failures to Sentry', async () => {
    const captureApiMappedError = vi.fn()
    vi.doMock('./observability/sentry.js', () => ({
      _resetApiSentryForTest: vi.fn(),
      captureApiException: vi.fn(),
      captureApiMappedError,
      flushApiSentry: vi.fn(),
      initializeApiSentry: vi.fn()
    }))

    const { mapCoreError } = await importApi()
    const mapped = mapCoreError({
      _tag: 'CoreError',
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      cause: new Error('Auth backend could not be reached')
    })

    expect(mapped._tag).toBe('Unauthorized')
    expect(captureApiMappedError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Auth backend could not be reached' }),
      expect.objectContaining({
        code: 'UNAUTHORIZED',
        rootCauseTag: 'Error',
        rootCauseMessage: 'Auth backend could not be reached'
      })
    )
  })
})
