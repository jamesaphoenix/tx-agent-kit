import { beforeEach, describe, expect, it, vi } from 'vitest'

interface OTelLogRecord {
  severityNumber: number
  severityText: string
  body: string
  attributes: Record<string, unknown>
}

const { otelEmitMock, otelGetLoggerMock } = vi.hoisted(() => {
  const otelEmitMock = vi.fn<(record: OTelLogRecord) => void>()
  const otelGetLoggerMock = vi.fn(() => ({
    emit: otelEmitMock
  }))

  return {
    otelEmitMock,
    otelGetLoggerMock
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

import { createLogger, createPerfLogger, logError, toErrorDetails } from './index.js'
import { getLoggingEnv } from './env.js'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.LOG_LEVEL
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
})

describe('logging helpers', () => {
  it('extracts structured details from unknown errors', () => {
    expect(toErrorDetails(new Error('nope'))).toMatchObject({
      errorName: 'Error',
      errorMessage: 'nope'
    })

    expect(toErrorDetails('plain failure')).toMatchObject({
      errorMessage: 'plain failure',
      errorType: 'string'
    })
  })

  it('logError forwards an error event to the logger', () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn()
    }

    logError(logger, new Error('boom'), 'worker.execute', { jobId: 'job-1' })

    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      'Error in worker.execute',
      expect.objectContaining({
        event: 'error',
        context: 'worker.execute',
        jobId: 'job-1',
        errorMessage: 'boom'
      }),
      expect.any(Error)
    )
  })

  it('createPerfLogger emits performance event on end', () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn()
    }

    const perf = createPerfLogger(logger, 'db.query', { table: 'users' })
    perf.end({ queryName: 'listUsers' })

    expect(logger.info).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('db.query completed in '),
      expect.objectContaining({
        event: 'performance',
        operation: 'db.query',
        table: 'users',
        queryName: 'listUsers'
      })
    )
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
