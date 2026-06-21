import { SpanStatusCode, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base'
import { EventEmitter } from 'node:events'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { runWithRedisCommandSpan as runWithRedisCommandSpanType } from './redis-client.js'

let runWithRedisCommandSpan: typeof runWithRedisCommandSpanType
const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)]
})

beforeAll(async () => {
  trace.setGlobalTracerProvider(provider)
  const redisClientModule = await import('./redis-client.js')
  runWithRedisCommandSpan = redisClientModule.runWithRedisCommandSpan
})

beforeEach(() => {
  exporter.reset()
})

afterAll(async () => {
  await provider.shutdown()
})

describe('runWithRedisCommandSpan', () => {
  it('records Redis command attributes using current semantic conventions', () => {
    const result = runWithRedisCommandSpan(
      'SET',
      {
        'server.address': '127.0.0.1',
        'server.port': 6379,
        'redis.key_prefix.enabled': true
      },
      () => 'ok'
    )

    expect(result).toBe('ok')
    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe('redis.set')
    expect(spans[0]?.attributes).toMatchObject({
      'db.system.name': 'redis',
      'db.operation.name': 'SET',
      'server.address': '127.0.0.1',
      'server.port': 6379,
      'redis.key_prefix.enabled': true
    })
  })

  it('marks Redis failures as errored spans and records the exception', async () => {
    const error = new Error('redis command failed')

    await expect(
      runWithRedisCommandSpan('DEL', {}, () => Promise.reject(error))
    ).rejects.toThrow('redis command failed')

    const span = exporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === 'redis.del')
    expect(span).toBeDefined()
    expect(span?.status).toMatchObject({
      code: SpanStatusCode.ERROR,
      message: 'redis command failed'
    })
    expect(span?.events.some((event) => event.name === 'exception')).toBe(true)
  })
})

describe('createRedisClient error handling', () => {
  afterEach(() => {
    vi.doUnmock('ioredis')
    vi.resetModules()
  })

  it('consumes ioredis error events and forwards them to the injected reporter', async () => {
    vi.doMock('ioredis', () => ({
      Redis: class MockRedis extends EventEmitter {
        readonly url: string
        readonly options: unknown
        sendCommand = vi.fn()

        constructor(url: string, options: unknown) {
          super()
          this.url = url
          this.options = options
        }
      }
    }))

    const { createRedisClient, setRedisErrorReporter } = await import('./redis-client.js')
    const reporter = vi.fn()
    setRedisErrorReporter(reporter)

    const client = createRedisClient({ url: 'redis://localhost:6379' }) as unknown as EventEmitter
    expect(client.listenerCount('error')).toBe(1)

    const dropError = new Error('Connection is closed.')
    // Consumed (no uncaught exception) AND forwarded to the injected reporter so
    // the connection drop is still sent to Sentry instead of silently swallowed.
    expect(() => client.emit('error', dropError)).not.toThrow()
    expect(reporter).toHaveBeenCalledWith(dropError)

    setRedisErrorReporter(() => {})
  })
})
