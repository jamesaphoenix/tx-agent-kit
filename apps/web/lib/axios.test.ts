import { describe, expect, it } from 'vitest'
import { buildTraceparentHeaderValue } from './axios'

describe('buildTraceparentHeaderValue', () => {
  it('formats a W3C traceparent header from a sampled client span context', () => {
    expect(
      buildTraceparentHeaderValue({
        traceId: '5c4a612b96a306b4614a41572843c3bf',
        spanId: '596994f690a2f638',
        traceFlags: 1
      })
    ).toBe('00-5c4a612b96a306b4614a41572843c3bf-596994f690a2f638-01')
  })

  it('does not emit traceparent for invalid noop span contexts', () => {
    expect(
      buildTraceparentHeaderValue({
        traceId: '00000000000000000000000000000000',
        spanId: '0000000000000000',
        traceFlags: 0
      })
    ).toBeNull()
  })
})
