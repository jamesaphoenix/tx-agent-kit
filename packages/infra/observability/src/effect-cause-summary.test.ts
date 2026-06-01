import { Cause } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  buildCauseReportError,
  causeLogContext,
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
})
