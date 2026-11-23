import { describe, expect, it } from 'vitest'
import { isTransientTemporalError } from './worker-resilience-policy.js'

const withCode = (message: string, code: number) => Object.assign(new Error(message), { code })
const named = (name: string, message: string) => Object.assign(new Error(message), { name })

describe('isTransientTemporalError', () => {
  it.each([
    ['the incident namespace error (TransportError)', named(
      'TransportError',
      'Namespace production was not found or otherwise could not be described: Status { code: Unavailable, message: "GetNamespace operation failed. Error no usable database connection found" }'
    )],
    ['a gRPC DEADLINE_EXCEEDED by code', withCode('Failed to describe schedule', 4)],
    ['a gRPC RESOURCE_EXHAUSTED by code', withCode('rate limited', 8)],
    ['a gRPC UNAVAILABLE by code', withCode('server gone', 14)],
    ['an UNAVAILABLE message', new Error('14 UNAVAILABLE: No connection established')],
    ['a DEADLINE_EXCEEDED message', new Error('4 DEADLINE_EXCEEDED: Deadline exceeded')],
    ['a refused connection', new Error('connect ECONNREFUSED 10.0.0.5:7233')],
    ['a transient cause behind a wrapper', new Error('Failed to start worker', { cause: withCode('x', 14) })]
  ])('treats %s as transient', (_label, error) => {
    expect(isTransientTemporalError(error)).toBe(true)
  })

  it.each([
    ['a workflow bundle failure', new Error('Webpack finished with errors, if you think this is a mistake please report it')],
    ['a programming error', new TypeError('Cannot read properties of undefined')],
    ['a gRPC INVALID_ARGUMENT', withCode('bad request', 3)],
    ['a non-Error value', 'oops'],
    ['undefined', undefined]
  ])('treats %s as permanent', (_label, error) => {
    expect(isTransientTemporalError(error)).toBe(false)
  })
})
