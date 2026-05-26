import { SpanStatusCode, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
