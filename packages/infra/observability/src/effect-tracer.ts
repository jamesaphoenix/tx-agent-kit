import * as OtelApi from '@opentelemetry/api'
import * as EffectOtelTracer from '@effect/opentelemetry/Tracer'
import { Effect, Layer, Tracer } from 'effect'

/**
 * Effect calls `Tracer.context` around EVERY operation a fiber runs while a
 * span is current, and `@effect/opentelemetry` answers each call with
 * `context.with(setSpan(active, span), op)`. With a context manager that
 * does real work on every `with` (for example one that forks a per-request
 * scope object), one request pays for hundreds of those calls. The garbage they
 * produce also keeps V8 collecting.
 *
 * The OpenTelemetry context for a span only depends on the span and on the
 * context it is entered from, so it is built once and reused:
 *   - already inside that context: run the operation directly;
 *   - entered from the same outer context as last time: re-enter the context
 *     built then, without asking the context manager to do its per-`with` work again;
 *   - anything else (first operation, or the fiber resumed under a different
 *     async context): take the stock path and remember its result.
 *
 * The context manager's `with` therefore runs once per span per outer context
 * instead of once per operation. Isolation between requests is unchanged, because a
 * different request means a different outer context and so a cache miss.
 */

/** Enters an already-built context without rebuilding it. */
export type EnterBuiltContext = <A>(context: OtelApi.Context, execution: () => A) => A

const enterWithContextApi: EnterBuiltContext = (context, execution) =>
  OtelApi.context.with(context, execution)

let enterBuiltContext: EnterBuiltContext = enterWithContextApi

/**
 * Seam for a context manager whose `with` is expensive (for example one that
 * forks a scope object per call). It can register a direct entry here, such as
 * running the context on its own AsyncLocalStorage. Pass `undefined` to
 * restore the plain `context.with`.
 */
export const setBuiltContextEntry = (enter: EnterBuiltContext | undefined): void => {
  enterBuiltContext = enter ?? enterWithContextApi
}

interface BuiltContext {
  /** The context the span was entered from. */
  readonly outer: OtelApi.Context
  /** The context operations of the span run in. */
  readonly inner: OtelApi.Context
}

export const withCachedSpanContext = (base: Tracer.Tracer): Tracer.Tracer => {
  const builtContexts = new WeakMap<Tracer.AnySpan, BuiltContext>()

  return Tracer.make({
    span: (name, parent, context, links, startTime, kind, options) =>
      base.span(name, parent, context, links, startTime, kind, options),
    context(execution, fiber) {
      const span = fiber.currentSpan
      if (span === undefined) {
        return execution()
      }

      const outer = OtelApi.context.active()
      const built = builtContexts.get(span)
      if (built !== undefined) {
        if (built.inner === outer) {
          return execution()
        }
        if (built.outer === outer) {
          return enterBuiltContext(built.inner, execution)
        }
      }

      return base.context(() => {
        builtContexts.set(span, { outer, inner: OtelApi.context.active() })
        return execution()
      }, fiber)
    }
  })
}

/** `EffectOtelTracer.layerGlobal` with the per-operation context cached. */
export const cachedContextTracerLayerGlobal = Layer.unwrapEffect(
  Effect.map(EffectOtelTracer.make, (tracer) => Layer.setTracer(withCachedSpanContext(tracer)))
).pipe(Layer.provideMerge(EffectOtelTracer.layerGlobalTracer))
