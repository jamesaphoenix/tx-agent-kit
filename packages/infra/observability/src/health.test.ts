import { describe, expect, it } from 'vitest'
import { isHealthCheckRequestUrl } from './health.js'

describe('isHealthCheckRequestUrl', () => {
  it('matches /health with or without a query string', () => {
    expect(isHealthCheckRequestUrl('/health')).toBe(true)
    expect(isHealthCheckRequestUrl('/health?probe=1')).toBe(true)
  })

  it('does not match lookalike paths', () => {
    expect(isHealthCheckRequestUrl('/healthz')).toBe(false)
    expect(isHealthCheckRequestUrl('/v1/health')).toBe(false)
    expect(isHealthCheckRequestUrl('/')).toBe(false)
  })
})
