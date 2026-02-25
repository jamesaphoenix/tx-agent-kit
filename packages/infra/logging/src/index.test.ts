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

beforeEach(() => {
  vi.clearAllMocks()
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
