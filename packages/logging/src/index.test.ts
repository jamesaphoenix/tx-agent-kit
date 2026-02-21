import { describe, expect, it, vi } from 'vitest'
import { createLogger, createPerfLogger, logError, toErrorDetails } from './index.js'

describe('createLogger', () => {
  it('creates child logger with scoped service name', () => {
    const root = createLogger('test-service')
    const child = root.child('openapi')

    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')
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
