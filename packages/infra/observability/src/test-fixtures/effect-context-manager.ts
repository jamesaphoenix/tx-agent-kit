import type { AsyncLocalStorage } from 'node:async_hooks'
import * as OtelApi from '@opentelemetry/api'
import * as EffectOtelResource from '@effect/opentelemetry/Resource'
import * as EffectOtelTracer from '@effect/opentelemetry/Tracer'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Effect, Layer } from 'effect'
import { cachedContextTracerLayerGlobal, setBuiltContextEntry } from '../effect-tracer.js'

// Runs one Effect program under a real AsyncLocalStorage context manager and
// reports how many times the manager's `with` ran, with the stock or the cached
// tracer layer. The counting manager stands in for any manager whose `with` is
// costly: it also registers a direct entry (its own AsyncLocalStorage) through
// the seam the cached tracer exposes, which is what a forking manager would do.
const mode = process.argv[2] === 'stock' ? 'stock' : 'cached'
const operations = 300

let withCalls = 0
class CountingContextManager extends AsyncLocalStorageContextManager {
  override with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: OtelApi.Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    withCalls += 1
    return super.with(context, fn, thisArg, ...args)
  }
}
const contextManager = new CountingContextManager()
const storage = Reflect.get(contextManager, '_asyncLocalStorage') as AsyncLocalStorage<OtelApi.Context>
setBuiltContextEntry((context, execution) => storage.run(context, execution))

const exporter = new InMemorySpanExporter()
const sdk = new NodeSDK({
  autoDetectResources: false,
  metricReaders: [],
  logRecordProcessors: [],
  contextManager,
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  instrumentations: []
})
sdk.start()

const activeSpanId = (): string | undefined => OtelApi.trace.getActiveSpan()?.spanContext().spanId
const observe = Effect.sync(activeSpanId)

const program = Effect.gen(function* () {
  const seen: Array<string | undefined> = []
  for (let index = 0; index < operations; index += 1) {
    seen.push(yield* observe)
  }
  const child = yield* observe.pipe(Effect.withSpan('canary.child'))
  const afterChild = yield* observe
  // Resume under a different async context (a timer), then keep going.
  yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5)))
  const afterAsync = yield* observe
  return { parentIds: [...new Set(seen)], child, afterChild, afterAsync }
}).pipe(Effect.withSpan('canary.parent'))

const tracerLayer = mode === 'stock' ? EffectOtelTracer.layerGlobal : cachedContextTracerLayerGlobal
const layer = Layer.provide(tracerLayer, EffectOtelResource.layer({ serviceName: 'effect-context-manager' }))

try {
  const before = withCalls
  const observed = await Effect.runPromise(Effect.provide(program, layer))
  const calls = withCalls - before
  const spans = Object.fromEntries(exporter.getFinishedSpans().map((span) => [span.name, span.spanContext().spanId]))
  process.stdout.write(JSON.stringify({ mode, operations, withCalls: calls, spans, observed }) + '\n')
} finally {
  await sdk.shutdown()
}
