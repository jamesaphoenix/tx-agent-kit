import { Cause } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  buildCauseReportError,
  causeLogContext,
  describeCauseForLog,
  shouldLogEffectCause,
  toFlattenedCauseChain
} from './effect-cause-summary.js'

// `shouldLogEffectCause` takes the app-specific expected-error-tags set as a
// parameter (structural + platform tags stay baked in). These tests bind a
// representative HTTP error tag set to exercise the "expected 4xx" branch.
const expectedHttpErrorTags = new Set(['BadRequest', 'Unauthorized', 'NotFound', 'Conflict'])

describe('effect cause summary', () => {
  it('keeps both branches of an Effect cause tree', () => {
    const cause = Cause.parallel(
      Cause.fail({
        _tag: 'DbError',
        code: 'DB_QUERY_FAILED',
        message: 'left db failed'
      }),
      Cause.die(new Error('right defect failed'))
    )

    expect(toFlattenedCauseChain(cause)).toEqual([
      { type: 'Parallel', tag: 'Parallel', code: undefined, message: undefined },
      { type: 'Fail', tag: 'Fail', code: undefined, message: undefined },
      { type: 'DbError', tag: 'DbError', code: 'DB_QUERY_FAILED', message: 'left db failed' },
      { type: 'Die', tag: 'Die', code: undefined, message: undefined },
      { type: 'Error', tag: 'Error', code: undefined, message: 'right defect failed' }
    ])
  })

  it('skips expected 4xx failures listed in the supplied expected-tags set', () => {
    expect(
      shouldLogEffectCause(Cause.fail({ _tag: 'BadRequest', message: 'Invalid input' }), expectedHttpErrorTags)
    ).toBe(false)
  })

  it('skips expected platform router misses regardless of the supplied set', () => {
    expect(
      shouldLogEffectCause(Cause.fail({ _tag: 'RouteNotFound', message: 'GET /missing' }), expectedHttpErrorTags)
    ).toBe(false)
  })

  it('logs a tag that is not in the expected set', () => {
    expect(
      shouldLogEffectCause(Cause.fail({ _tag: 'BadRequest', message: 'Invalid input' }), new Set<string>())
    ).toBe(true)
  })

  it('logs internal errors and defects regardless of the supplied set', () => {
    expect(
      shouldLogEffectCause(
        Cause.fail({ _tag: 'InternalError', message: 'Internal server error' }),
        expectedHttpErrorTags
      )
    ).toBe(true)
    expect(shouldLogEffectCause(Cause.die(new Error('unexpected defect')), expectedHttpErrorTags)).toBe(true)
  })

  it('surfaces root cause fields for log searching', () => {
    expect(
      causeLogContext({
        _tag: 'DbError',
        code: 'DB_DECODE_FAILED',
        message: 'decode failed',
        cause: {
          _id: 'ParseError',
          message: 'actual "agent_execution"'
        }
      })
    ).toMatchObject({
      causeTag: 'DbError',
      causeCode: 'DB_DECODE_FAILED',
      rootCauseTag: 'ParseError',
      rootCauseMessage: 'actual "agent_execution"'
    })
  })

  describe('buildCauseReportError', () => {
    it('returns the real underlying Error so Sentry shows its true stack', () => {
      const realError = new Error('connection terminated unexpectedly')
      const cause = Cause.die(realError)

      const reported = buildCauseReportError(cause, { fallbackMessage: 'fallback' })

      expect(reported).toBe(realError)
      expect(reported.stack).toBe(realError.stack)
    })

    it('recovers the deepest nested Error from a fail cause chain', () => {
      const dbError = new Error('insert violates foreign key constraint')
      const cause = Cause.fail({ _tag: 'DbError', code: 'DB_QUERY_FAILED', cause: dbError })

      const reported = buildCauseReportError(cause, { fallbackMessage: 'fallback' })

      expect(reported).toBe(dbError)
    })

    it('synthesizes an error carrying the pretty cause stack when no JS Error exists', () => {
      const cause = Cause.fail({
        _tag: 'HttpApiDecodeError',
        message: 'Expected string, actual null at /name'
      })

      const reported = buildCauseReportError(cause, {
        fallbackMessage: 'Unhandled Effect API cause reached route boundary',
        prettyStack: 'HttpApiDecodeError: Expected string, actual null at /name\n  at handler'
      })

      expect(reported.name).toBe('HttpApiDecodeError')
      expect(reported.message).toBe('Expected string, actual null at /name')
      expect(reported.stack).toContain('at handler')
    })

    it('falls back to the provided message when the cause carries no message', () => {
      const reported = buildCauseReportError(Cause.fail({ _tag: 'Whatever' }), {
        fallbackMessage: 'Unhandled Effect API cause reached route boundary'
      })

      expect(reported.name).toBe('Whatever')
      expect(reported.message).toBe('Whatever')
    })
  })

  it('does not let opaque Error.cause metadata hide the real error frame', () => {
    const jwtExpired = new Error('"exp" claim timestamp check failed') as Error & {
      cause?: unknown
    }
    jwtExpired.name = 'JWTExpired'
    jwtExpired.cause = {
      claim: 'exp',
      reason: 'check_failed',
      payload: {
        sub: 'user-1',
        exp: 1
      }
    }

    const authError = new Error('Invalid session token') as Error & { cause?: unknown }
    authError.name = 'AuthError'
    authError.cause = jwtExpired

    const context = causeLogContext(authError)
    expect(context).toMatchObject({
      rootCauseType: 'JWTExpired',
      rootCauseTag: 'JWTExpired',
      rootCauseMessage: '"exp" claim timestamp check failed'
    })
    expect(context.causeChain).toEqual([
      { type: 'AuthError', tag: 'AuthError', code: undefined, message: 'Invalid session token' },
      {
        type: 'JWTExpired',
        tag: 'JWTExpired',
        code: undefined,
        message: '"exp" claim timestamp check failed'
      },
      {
        type: 'object',
        tag: undefined,
        code: undefined,
        message: '{"claim":"exp","reason":"check_failed","payload":{"sub":"user-1","exp":1}}'
      }
    ])
    expect(shouldLogEffectCause(authError, new Set(['AuthError', 'JWTExpired']))).toBe(false)
  })

  it('serializes OAuth response body errors without collapsing objects', () => {
    const responseBodyError = new Error('server responded with an error in the response body') as Error & {
      cause?: unknown
      code?: string
    }
    responseBodyError.name = 'ResponseBodyError'
    responseBodyError.code = 'OAUTH_RESPONSE_BODY_ERROR'
    responseBodyError.cause = {
      error: 'invalid_client',
      error_description: 'The OAuth client was not found.',
      client_secret: 'super-secret-value'
    }

    const callbackError = new Error(
      `Failed to complete Google OIDC callback: ${describeCauseForLog(responseBodyError)}`,
      { cause: responseBodyError }
    )

    const context = causeLogContext(callbackError)
    expect(context.causeMessage).not.toContain('[object Object]')
    expect(context.causeMessage).toContain('"error":"invalid_client"')
    expect(context.causeMessage).toContain('"client_secret":"[REDACTED]"')
    expect(context.rootCauseMessage).toBe('invalid_client')
    expect(context.causeChain).toContainEqual({
      type: 'object',
      tag: undefined,
      code: undefined,
      message: '{"error":"invalid_client","error_description":"The OAuth client was not found.","client_secret":"[REDACTED]"}'
    })
  })

  it('serializes generic object causes without making metadata the root cause', () => {
    const providerError = new Error('provider failed') as Error & { cause?: unknown }
    providerError.name = 'ProviderError'
    providerError.cause = {
      requestId: 'req-1',
      status: 400,
      access_token: 'secret-token'
    }

    const context = causeLogContext(providerError)
    expect(context).toMatchObject({
      rootCauseType: 'ProviderError',
      rootCauseTag: 'ProviderError',
      rootCauseMessage: 'provider failed'
    })
    expect(context.causeChain).toContainEqual({
      type: 'object',
      tag: undefined,
      code: undefined,
      message: '{"requestId":"req-1","status":400,"access_token":"[REDACTED]"}'
    })
    expect(shouldLogEffectCause(providerError, new Set())).toBe(true)
  })
})
