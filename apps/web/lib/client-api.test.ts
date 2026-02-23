import { describe, expect, it } from 'vitest'
import { ApiClientError } from './client-api'

describe('ApiClientError', () => {
  it('is correctly identified by instanceof', () => {
    const err = new ApiClientError('test', 401)
    expect(err instanceof ApiClientError).toBe(true)
    expect(err instanceof Error).toBe(true)
    expect(err.status).toBe(401)
    expect(err.name).toBe('ApiClientError')
    expect(err.message).toBe('test')
  })

  it('supports undefined status', () => {
    const err = new ApiClientError('Network error')
    expect(err.status).toBeUndefined()
    expect(err instanceof ApiClientError).toBe(true)
  })

  it('instanceof works when thrown and caught', () => {
    let caught: unknown
    try {
      throw new ApiClientError('thrown', 403)
    } catch (e) {
      caught = e
    }
    expect(caught instanceof ApiClientError).toBe(true)
    expect((caught as ApiClientError).status).toBe(403)
  })
})
