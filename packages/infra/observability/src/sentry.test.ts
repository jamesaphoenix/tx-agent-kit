import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSentryReporter, SENTRY_SPOTLIGHT_PLACEHOLDER_DSN } from './sentry.js'

const {
  sentryInitMock,
  sentrySetTagMock,
  sentryCaptureExceptionMock,
  sentryFlushMock,
  sentryWithScopeMock,
  scopeSetTagMock,
  scopeSetFingerprintMock,
  scopeSetContextMock
} = vi.hoisted(() => {
  const scopeSetTagMock = vi.fn()
  const scopeSetFingerprintMock = vi.fn()
  const scopeSetContextMock = vi.fn()

  return {
    sentryInitMock: vi.fn(),
    sentrySetTagMock: vi.fn(),
    sentryCaptureExceptionMock: vi.fn(),
    sentryFlushMock: vi.fn(() => Promise.resolve(true)),
    scopeSetTagMock,
    scopeSetFingerprintMock,
    scopeSetContextMock,
    sentryWithScopeMock: vi.fn((callback: (scope: unknown) => void) => {
      callback({
        setTag: scopeSetTagMock,
        setFingerprint: scopeSetFingerprintMock,
        setContext: scopeSetContextMock
      })
    })
  }
})

vi.mock('@sentry/node', () => ({
  init: sentryInitMock,
  setTag: sentrySetTagMock,
  withScope: sentryWithScopeMock,
  captureException: sentryCaptureExceptionMock,
  flush: sentryFlushMock
}))

const { getActiveSpanMock } = vi.hoisted(() => ({
  getActiveSpanMock: vi.fn<() => unknown>(() => undefined)
}))

vi.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: getActiveSpanMock }
}))

const baseInit = {
  dsn: 'https://reporter@sentry.example.com/1',
  environment: 'staging',
  spotlightEnabled: false,
  component: 'api'
}

describe('createSentryReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveSpanMock.mockReturnValue(undefined)
  })

  it('is a no-op until initialized', async () => {
    const reporter = createSentryReporter()

    reporter.captureException(new Error('before'))
    reporter.captureScoped(new Error('before'), { boundary: 'test_boundary' })
    await reporter.flush()

    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled()
    expect(sentryWithScopeMock).not.toHaveBeenCalled()
    expect(sentryFlushMock).not.toHaveBeenCalled()
  })

  it('skips initialization when no DSN is provided', async () => {
    const reporter = createSentryReporter()

    const initialized = await reporter.initialize({ ...baseInit, dsn: undefined })

    expect(initialized).toBe(false)
    expect(sentryInitMock).not.toHaveBeenCalled()
  })

  it('initializes once and tags the component; a second call is a no-op', async () => {
    const reporter = createSentryReporter()

    const first = await reporter.initialize(baseInit)
    const second = await reporter.initialize(baseInit)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
    expect(sentryInitMock).toHaveBeenCalledWith({
      dsn: baseInit.dsn,
      environment: 'staging',
      tracesSampleRate: 0,
      spotlight: false
    })
    expect(sentrySetTagMock).toHaveBeenCalledWith('component', 'api')
  })

  it('enables full trace sampling + spotlight when spotlightEnabled', async () => {
    const reporter = createSentryReporter()

    await reporter.initialize({
      dsn: SENTRY_SPOTLIGHT_PLACEHOLDER_DSN,
      environment: 'development',
      spotlightEnabled: true,
      component: 'worker'
    })

    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 1.0, spotlight: true })
    )
  })

  it('captureScoped sets the boundary tag, skips undefined tags, and sets contexts + fingerprint', async () => {
    const reporter = createSentryReporter()
    await reporter.initialize(baseInit)

    const error = new Error('boom')
    reporter.captureScoped(error, {
      boundary: 'api_error_mapping',
      tags: {
        core_error_code: 'BAD_REQUEST',
        http_error_tag: undefined,
        route: '/v1/things'
      },
      fingerprint: ['api-mapped-error', 'things.list', undefined, '   '],
      contexts: {
        request: { method: 'GET' }
      }
    })

    expect(sentryWithScopeMock).toHaveBeenCalledTimes(1)
    expect(scopeSetTagMock).toHaveBeenCalledWith('error_boundary', 'api_error_mapping')
    expect(scopeSetTagMock).toHaveBeenCalledWith('core_error_code', 'BAD_REQUEST')
    expect(scopeSetTagMock).toHaveBeenCalledWith('route', '/v1/things')
    // undefined tag values are skipped, not set to a placeholder string.
    expect(scopeSetTagMock).not.toHaveBeenCalledWith('http_error_tag', expect.anything())
    // Blank/undefined fingerprint parts collapse to 'unknown' for stable grouping.
    expect(scopeSetFingerprintMock).toHaveBeenCalledWith([
      'api-mapped-error',
      'things.list',
      'unknown',
      'unknown'
    ])
    expect(scopeSetContextMock).toHaveBeenCalledWith('request', { method: 'GET' })
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(error)
  })

  it('captureScoped links the active OTEL trace as tags', async () => {
    const reporter = createSentryReporter()
    await reporter.initialize(baseInit)

    getActiveSpanMock.mockReturnValue({
      spanContext: () => ({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331'
      })
    })

    reporter.captureScoped(new Error('boom'), { boundary: 'worker_activity' })

    expect(scopeSetTagMock).toHaveBeenCalledWith('trace_id', '0af7651916cd43dd8448eb211c80319c')
    expect(scopeSetTagMock).toHaveBeenCalledWith('span_id', 'b7ad6b7169203331')
  })

  it('captureScoped omits trace tags when there is no active span', async () => {
    const reporter = createSentryReporter()
    await reporter.initialize(baseInit)

    reporter.captureScoped(new Error('boom'), { boundary: 'worker_activity' })

    expect(scopeSetTagMock).not.toHaveBeenCalledWith('trace_id', expect.anything())
    expect(scopeSetTagMock).not.toHaveBeenCalledWith('span_id', expect.anything())
  })

  it('captureException + flush forward to Sentry once initialized', async () => {
    const reporter = createSentryReporter()
    await reporter.initialize(baseInit)

    const error = new Error('crash')
    reporter.captureException(error)
    await reporter.flush(1234)

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(error)
    expect(sentryFlushMock).toHaveBeenCalledWith(1234)
  })

  it('reset returns the reporter to a pre-init no-op state', async () => {
    const reporter = createSentryReporter()
    await reporter.initialize(baseInit)

    reporter.reset()
    vi.clearAllMocks()

    reporter.captureException(new Error('after-reset'))
    await reporter.flush()

    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled()
    expect(sentryFlushMock).not.toHaveBeenCalled()
  })
})
