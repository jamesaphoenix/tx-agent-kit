import { describe, expect, it } from 'vitest'
import {
  getApiRequestContext,
  markApiErrorReported,
  runWithApiRequestContext,
  wasApiErrorReported
} from './request-context.js'

describe('request-context error-reported flag', () => {
  it('fails OPEN: returns false when no request context is active', () => {
    // No active context => the last-resort middleware must still log, never
    // silence. markApiErrorReported must also be a safe no-op here.
    expect(wasApiErrorReported()).toBe(false)
    expect(() => markApiErrorReported()).not.toThrow()
    expect(wasApiErrorReported()).toBe(false)
  })

  it('starts false and flips to true within a request scope', () => {
    runWithApiRequestContext({ method: 'POST', path: '/x' }, () => {
      expect(wasApiErrorReported()).toBe(false)
      markApiErrorReported()
      expect(wasApiErrorReported()).toBe(true)
    })
  })

  it('isolates the flag per request scope', () => {
    runWithApiRequestContext({ method: 'POST', path: '/a' }, () => {
      markApiErrorReported()
      expect(wasApiErrorReported()).toBe(true)
    })

    // A fresh scope must start clean — the cell is created per enter/run.
    runWithApiRequestContext({ method: 'GET', path: '/b' }, () => {
      expect(wasApiErrorReported()).toBe(false)
    })
  })

  it('preserves caller-supplied context fields alongside the cell', () => {
    runWithApiRequestContext({ method: 'PATCH', path: '/c', operationId: 'op.c' }, () => {
      expect(getApiRequestContext()).toMatchObject({
        method: 'PATCH',
        path: '/c',
        operationId: 'op.c'
      })
    })
  })
})
