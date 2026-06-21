import { describe, expect, it } from 'vitest'
import { evaluateWebhookEnvironment } from './sentry-webhooks.js'

describe('evaluateWebhookEnvironment', () => {
  it('accepts a matching tagged environment', () => {
    expect(evaluateWebhookEnvironment('staging', 'staging')).toEqual({ kind: 'accept' })
    expect(evaluateWebhookEnvironment('production', 'production')).toEqual({
      kind: 'accept'
    })
  })

  it('rejects a mismatched tagged environment', () => {
    const decision = evaluateWebhookEnvironment('production', 'staging')
    expect(decision.kind).toBe('reject')
    if (decision.kind === 'reject') {
      expect(decision.reason).toContain('Environment mismatch')
    }
  })

  it('rejects an unsupported environment tag', () => {
    const decision = evaluateWebhookEnvironment('dev', 'staging')
    expect(decision.kind).toBe('reject')
    if (decision.kind === 'reject') {
      expect(decision.reason).toContain('Unsupported Sentry environment')
    }
  })

  it('accepts an env-less issue on staging', () => {
    expect(evaluateWebhookEnvironment(null, 'staging')).toEqual({ kind: 'accept' })
    expect(evaluateWebhookEnvironment(undefined, 'staging')).toEqual({ kind: 'accept' })
    expect(evaluateWebhookEnvironment('  ', 'staging')).toEqual({ kind: 'accept' })
  })

  it('rejects an env-less issue on production', () => {
    const decision = evaluateWebhookEnvironment(null, 'production')
    expect(decision.kind).toBe('reject')
    if (decision.kind === 'reject') {
      expect(decision.reason).toBe('missing environment tag; required on production')
    }
    expect(evaluateWebhookEnvironment('', 'production').kind).toBe('reject')
  })
})
