import { createServer } from 'node:http'
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerResponse } from '@effect/platform'
import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Tracer } from 'effect'
import { describe, expect, it } from 'vitest'
import { isUntracedRequest } from './untraced-requests.js'

const serveWithRecordedSpans = async (path: string): Promise<{ status: number; spans: string[] }> => {
  const spans: string[] = []
  const base = Tracer.make({
    span: (name, parent, context, links, startTime, kind) => {
      spans.push(name)
      return {
        _tag: 'Span',
        name,
        spanId: `span-${spans.length}`,
        traceId: 'trace',
        parent,
        context,
        status: { _tag: 'Started', startTime },
        attributes: new Map(),
        links,
        sampled: true,
        kind,
        end: () => undefined,
        attribute: () => undefined,
        event: () => undefined,
        addLinks: () => undefined
      }
    },
    context: (execution) => execution()
  })
  const app = HttpRouter.empty.pipe(
    HttpRouter.get('/health', HttpServerResponse.text('healthy')),
    HttpRouter.get('/v1/teams', HttpServerResponse.text('teams'))
  )
  // Same shape and placement as makeServerLive: a served Node HTTP server with
  // the predicate applied around the whole server layer.
  const runtime = ManagedRuntime.make(
    HttpServer.serve(app).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0, host: '127.0.0.1' })),
      HttpMiddleware.withTracerDisabledWhen(isUntracedRequest),
      Layer.provide(Layer.setTracer(base))
    )
  )
  try {
    const server = await runtime.runPromise(HttpServer.HttpServer)
    if (server.address._tag !== 'TcpAddress') {
      throw new Error('Expected a TCP address')
    }
    const response = await fetch(`http://127.0.0.1:${server.address.port}${path}`)
    await response.text()
    return { status: response.status, spans }
  } finally {
    await runtime.dispose()
  }
}

describe('untraced requests', () => {
  it('opens no Effect span for health probes, with or without a query string', async () => {
    expect(await serveWithRecordedSpans('/health')).toEqual({ status: 200, spans: [] })
    expect(await serveWithRecordedSpans('/health?probe=cloudflare')).toEqual({ status: 200, spans: [] })
  })

  it('still traces every other route', async () => {
    const served = await serveWithRecordedSpans('/v1/teams')

    expect(served.status).toBe(200)
    expect(served.spans).toEqual(['http.server GET'])
  })

  it('does not treat a lookalike path as a health probe', async () => {
    expect(isUntracedRequest({ url: '/healthz' } as Parameters<typeof isUntracedRequest>[0])).toBe(false)
    expect(isUntracedRequest({ url: '/v1/health' } as Parameters<typeof isUntracedRequest>[0])).toBe(false)
    expect(await Effect.runPromise(Effect.succeed(isUntracedRequest({ url: '/health' } as Parameters<typeof isUntracedRequest>[0])))).toBe(true)
  })
})
