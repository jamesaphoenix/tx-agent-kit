import { beforeEach, describe, expect, it, vi } from 'vitest'

interface OTelLogRecord {
  severityNumber: number
  severityText: string
  body: string
  attributes: Record<string, unknown>
}

const { otelEmitMock, otelGetLoggerMock, traceGetActiveSpanMock } = vi.hoisted(() => {
  const otelEmitMock = vi.fn<(record: OTelLogRecord) => void>()
  const otelGetLoggerMock = vi.fn(() => ({
    emit: otelEmitMock
  }))
  const traceGetActiveSpanMock = vi.fn<() => unknown>(() => undefined)

  return {
    otelEmitMock,
    otelGetLoggerMock,
    traceGetActiveSpanMock
  }
})

vi.mock('@opentelemetry/api-logs', () => ({
  logs: {
    getLogger: otelGetLoggerMock
  },
  SeverityNumber: {
    DEBUG: 5,
    INFO: 9,
    WARN: 13,
    ERROR: 17
  }
}))

vi.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: traceGetActiveSpanMock }
}))

import { createLogger, getActiveSpanContext } from './index.js'
import { getLoggingEnv } from './env.js'

beforeEach(() => {
  vi.clearAllMocks()
  traceGetActiveSpanMock.mockReturnValue(undefined)
  delete process.env.LOG_LEVEL
})

describe('getActiveSpanContext', () => {
  it('returns undefined when there is no active span', () => {
    expect(getActiveSpanContext()).toBeUndefined()
  })

  it('returns the active span trace correlation', () => {
    traceGetActiveSpanMock.mockReturnValue({
      spanContext: () => ({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1
      })
    })

    expect(getActiveSpanContext()).toEqual({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: 1
    })
  })

  it('returns undefined when the span context has no trace id', () => {
    traceGetActiveSpanMock.mockReturnValue({
      spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 })
    })

    expect(getActiveSpanContext()).toBeUndefined()
  })
})

describe('createLogger', () => {
  it('creates child logger with scoped service name', () => {
    const root = createLogger('test-service')
    const child = root.child('openapi')

    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')
  })

  it('emits OTEL log records through the global logger provider', () => {
    const logger = createLogger('test-service')
    logger.info('hello world', { requestId: 'req-1' })

    expect(otelGetLoggerMock).toHaveBeenCalledWith('test-service')
    expect(otelEmitMock).toHaveBeenCalledOnce()

    const emittedRecord = otelEmitMock.mock.calls[0]?.[0]
    if (!emittedRecord) {
      throw new Error('Expected OTEL log record to be emitted')
    }

    expect(emittedRecord.severityNumber).toBe(9)
    expect(emittedRecord.severityText).toBe('INFO')
    expect(emittedRecord.body).toBe('hello world')
    expect(emittedRecord.attributes['service.name']).toBe('test-service')
    expect(emittedRecord.attributes['context.requestId']).toBe('req-1')
  })

  it('copies active trace context into stdout entries and OTEL log attributes', () => {
    const traceId = '0af7651916cd43dd8448eb211c80319c'
    const spanId = 'b7ad6b7169203331'
    const stdoutWriteMock = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    traceGetActiveSpanMock.mockReturnValue({
      spanContext: () => ({
        traceId,
        spanId,
        traceFlags: 1
      })
    })

    const logger = createLogger('test-service')
    logger.info('correlated event', { requestId: 'req-2' })

    const rawLogLine = String(stdoutWriteMock.mock.calls[0]?.[0] ?? '').trim()
    stdoutWriteMock.mockRestore()

    const stdoutEntry = JSON.parse(rawLogLine) as Record<string, unknown>

    expect(stdoutEntry.trace_id).toBe(traceId)
    expect(stdoutEntry.span_id).toBe(spanId)
    expect(stdoutEntry.trace_flags).toBe(1)

    const emittedRecord = otelEmitMock.mock.calls[0]?.[0]
    if (!emittedRecord) {
      throw new Error('Expected OTEL log record to be emitted')
    }

    expect(emittedRecord.attributes.trace_id).toBe(traceId)
    expect(emittedRecord.attributes.span_id).toBe(spanId)
    expect(emittedRecord.attributes.trace_flags).toBe(1)
  })

  it('serializes BigInt context values without crashing stdout logging', () => {
    const stdoutWriteMock = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logger = createLogger('test-service')

    expect(() => logger.info('bigint context', { count: 1n })).not.toThrow()

    const rawLogLine = String(stdoutWriteMock.mock.calls[0]?.[0] ?? '').trim()
    stdoutWriteMock.mockRestore()

    const stdoutEntry = JSON.parse(rawLogLine) as {
      context?: Record<string, unknown>
    }
    expect(stdoutEntry.context?.count).toBe('1')
  })

  it('serializes circular context values without crashing stdout logging', () => {
    const stdoutWriteMock = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logger = createLogger('test-service')
    const circularContext: Record<string, unknown> = { requestId: 'req-circular' }
    circularContext.self = circularContext

    expect(() => logger.info('circular context', circularContext)).not.toThrow()

    const rawLogLine = String(stdoutWriteMock.mock.calls[0]?.[0] ?? '').trim()
    stdoutWriteMock.mockRestore()

    const stdoutEntry = JSON.parse(rawLogLine) as {
      context?: Record<string, unknown>
    }
    expect(stdoutEntry.context?.requestId).toBe('req-circular')
    expect(stdoutEntry.context?.self).toEqual({
      requestId: 'req-circular',
      self: '[Circular]'
    })
  })

  it('never throws when stdout write fails and degrades to a stderr fallback', () => {
    const stdoutWriteMock = vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      throw new Error('EPIPE')
    })
    const stderrWriteMock = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const logger = createLogger('test-service')

    expect(() => logger.info('stdout failure')).not.toThrow()
    expect(stderrWriteMock).toHaveBeenCalledOnce()

    stdoutWriteMock.mockRestore()
    stderrWriteMock.mockRestore()
  })
})

describe('getLoggingEnv', () => {
  it('defaults to debug when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development'
    expect(getLoggingEnv().LOG_LEVEL).toBe('debug')
  })

  it('defaults to debug when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test'
    expect(getLoggingEnv().LOG_LEVEL).toBe('debug')
  })

  it('defaults to warn when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production'
    expect(getLoggingEnv().LOG_LEVEL).toBe('warn')
  })

  it('defaults to warn when NODE_ENV is staging', () => {
    process.env.NODE_ENV = 'staging'
    expect(getLoggingEnv().LOG_LEVEL).toBe('warn')
  })

  it('respects explicit LOG_LEVEL override', () => {
    process.env.NODE_ENV = 'production'
    process.env.LOG_LEVEL = 'info'
    expect(getLoggingEnv().LOG_LEVEL).toBe('info')
  })

  it('ignores invalid LOG_LEVEL and falls back to default', () => {
    process.env.NODE_ENV = 'development'
    process.env.LOG_LEVEL = 'verbose'
    expect(getLoggingEnv().LOG_LEVEL).toBe('debug')
  })

  it('normalizes LOG_LEVEL to lowercase', () => {
    process.env.LOG_LEVEL = 'ERROR'
    expect(getLoggingEnv().LOG_LEVEL).toBe('error')
  })
})

describe('log level filtering', () => {
  it('suppresses debug logs when level is warn', () => {
    const logger = createLogger('test-service', {}, 'warn')
    logger.debug('should be suppressed')
    logger.info('should also be suppressed')

    expect(otelEmitMock).not.toHaveBeenCalled()
  })

  it('emits warn and error when level is warn', () => {
    const logger = createLogger('test-service', {}, 'warn')
    logger.warn('visible warning')
    logger.error('visible error')

    expect(otelEmitMock).toHaveBeenCalledTimes(2)
  })

  it('emits all levels when level is debug', () => {
    const logger = createLogger('test-service', {}, 'debug')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    expect(otelEmitMock).toHaveBeenCalledTimes(4)
  })

  it('child logger inherits parent log level', () => {
    const logger = createLogger('test-service', {}, 'error')
    const child = logger.child('sub')
    child.warn('suppressed')
    child.error('visible')

    expect(otelEmitMock).toHaveBeenCalledTimes(1)
  })
})
