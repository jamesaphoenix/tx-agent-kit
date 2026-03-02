import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import {
  expectApiSuccess,
  expectApiSuccessWithSchema,
  expectApiError,
  expectApiList,
  expectUnauthorized,
  expectNotFound,
  expectConflict,
  type ApiResult
} from './api-assertions.js'

const mockResponse = (status: number): Response =>
  new Response(null, { status })

const makeResult = <T>(status: number, body: T): ApiResult<T> => ({
  response: mockResponse(status),
  body
})

describe('api-assertions', () => {
  describe('expectApiSuccess', () => {
    it('returns body on 200', () => {
      const body = { id: '1', name: 'Alice' }
      const result = expectApiSuccess(makeResult(200, body))
      expect(result).toEqual(body)
    })

    it('returns body on 201', () => {
      const body = { id: '1' }
      const result = expectApiSuccess(makeResult(201, body))
      expect(result).toEqual(body)
    })

    it('asserts specific status when provided', () => {
      const body = { ok: true }
      const result = expectApiSuccess(makeResult(201, body), 201)
      expect(result).toEqual(body)
    })

    it('throws when status is not 2xx', () => {
      expect(() => expectApiSuccess(makeResult(400, { message: 'bad' }))).toThrow()
    })

    it('throws when specific status does not match', () => {
      expect(() => expectApiSuccess(makeResult(200, {}), 201)).toThrow()
    })
  })

  describe('expectApiSuccessWithSchema', () => {
    const testSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String
    })

    it('returns decoded body on success', () => {
      const body = { id: '1', name: 'Alice' }
      const result = expectApiSuccessWithSchema(makeResult(200, body), testSchema)
      expect(result).toEqual(body)
    })

    it('throws when body does not match schema', () => {
      const body = { id: 123, name: 'Alice' }
      expect(() => expectApiSuccessWithSchema(makeResult(200, body), testSchema)).toThrow(
        'Response body did not match schema'
      )
    })

    it('throws when status is not 2xx', () => {
      expect(() =>
        expectApiSuccessWithSchema(makeResult(500, {}), testSchema)
      ).toThrow()
    })
  })

  describe('expectApiError', () => {
    it('passes on matching status', () => {
      const body = { message: 'Not found' }
      const result = expectApiError(makeResult(404, body), 404)
      expect(result.message).toBe('Not found')
    })

    it('passes on matching status and message substring', () => {
      const body = { message: 'User already exists' }
      const result = expectApiError(makeResult(409, body), 409, 'already exists')
      expect(result.message).toContain('already exists')
    })

    it('throws when status does not match', () => {
      expect(() =>
        expectApiError(makeResult(400, { message: 'bad' }), 404)
      ).toThrow()
    })

    it('throws when message does not contain expected substring', () => {
      expect(() =>
        expectApiError(makeResult(404, { message: 'Gone' }), 404, 'not found')
      ).toThrow()
    })
  })

  describe('expectApiList', () => {
    it('passes with valid paginated body', () => {
      const body = { data: [{ id: '1' }], total: 1, nextCursor: null, prevCursor: null }
      const result = expectApiList(makeResult(200, body))
      expect(result.data).toHaveLength(1)
      expect(result.total).toBe(1)
    })

    it('asserts expected length', () => {
      const body = { data: [{ id: '1' }, { id: '2' }], total: 2, nextCursor: null, prevCursor: null }
      const result = expectApiList(makeResult(200, body), 2)
      expect(result.data).toHaveLength(2)
    })

    it('throws when length does not match', () => {
      const body = { data: [{ id: '1' }], total: 1, nextCursor: null, prevCursor: null }
      expect(() => expectApiList(makeResult(200, body), 2)).toThrow()
    })

    it('throws when status is not expected', () => {
      const body = { data: [], total: 0, nextCursor: null, prevCursor: null }
      expect(() => expectApiList(makeResult(500, body))).toThrow()
    })
  })

  describe('shortcut matchers', () => {
    it('expectUnauthorized asserts 401', () => {
      const body = { message: 'Invalid token' }
      const result = expectUnauthorized(makeResult(401, body))
      expect(result.message).toBe('Invalid token')
    })

    it('expectNotFound asserts 404', () => {
      const body = { message: 'Resource not found' }
      const result = expectNotFound(makeResult(404, body))
      expect(result.message).toBe('Resource not found')
    })

    it('expectConflict asserts 409', () => {
      const body = { message: 'Already exists' }
      const result = expectConflict(makeResult(409, body))
      expect(result.message).toBe('Already exists')
    })

    it('expectUnauthorized throws on wrong status', () => {
      expect(() => expectUnauthorized(makeResult(403, { message: 'forbidden' }))).toThrow()
    })
  })
})
