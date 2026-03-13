import { Effect, Exit, FiberRef } from 'effect'
import { context, trace, SpanKind, SpanStatusCode, type Context as OtelContext, type Span } from '@opentelemetry/api'
import type { CallModelInput, Tool } from '@openrouter/sdk'
import type { OpenResponsesNonStreamingResponse } from '@openrouter/sdk/models'
import { callModel } from './openrouter.js'
import { AiError } from './errors.js'
import { getAiEnv } from './env.js'

const AI_TRACER_NAME = 'tx-agent-kit.ai'

/**
 * FiberRef that carries the current OTel context through Effect's fiber model.
 * This is necessary because Effect fibers don't preserve Node.js AsyncLocalStorage
 * context, so `context.active()` alone won't see parent spans set by `withAgentTrace`
 * or `withAgentStep`. By threading the OTel context via FiberRef, child spans
 * created with `tracedCallModel` or nested `withAgentStep` calls correctly
 * inherit the parent span's traceId.
 */
const OtelContextRef: FiberRef.FiberRef<OtelContext | null> =
  FiberRef.unsafeMake<OtelContext | null>(null)

/**
 * Gets the current OTel parent context — from the FiberRef if set,
 * otherwise falls back to the global `context.active()`.
 */
const getParentContext: Effect.Effect<OtelContext> = Effect.map(
  FiberRef.get(OtelContextRef),
  (ref) => ref ?? context.active()
)

/**
 * Creates a span parented under the current traced context and runs
 * `fn` with that span set as the new parent for any children.
 */
const withTracedSpan = <A, E>(
  name: string,
  spanOptions: Parameters<ReturnType<typeof trace.getTracer>['startSpan']>[1],
  fn: (span: Span) => Effect.Effect<A, E>
): Effect.Effect<A, E> =>
  Effect.flatMap(getParentContext, (parentCtx) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const tracer = trace.getTracer(AI_TRACER_NAME)
        return tracer.startSpan(name, spanOptions, parentCtx)
      }),
      (span) => {
        const childCtx = trace.setSpan(parentCtx, span)
        return Effect.locally(fn(span), OtelContextRef, childCtx)
      },
      (span, exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) {
            span.setStatus({ code: SpanStatusCode.ERROR })
          } else {
            span.setStatus({ code: SpanStatusCode.OK })
          }
          span.end()
        })
    )
  )

export interface TracedCallModelOptions {
  readonly stepName?: string
}

/**
 * Set usage attributes on a span from a completed response.
 */
const setUsageAttributes = (
  span: Span,
  response: OpenResponsesNonStreamingResponse
): void => {
  span.setAttribute('gen_ai.response.model', response.model)

  if (response.usage) {
    span.setAttribute(
      'gen_ai.usage.prompt_tokens',
      response.usage.inputTokens
    )
    span.setAttribute(
      'gen_ai.usage.completion_tokens',
      response.usage.outputTokens
    )
    span.setAttribute(
      'gen_ai.usage.total_tokens',
      response.usage.totalTokens
    )

    if (response.usage.cost !== undefined && response.usage.cost !== null) {
      span.setAttribute('gen_ai.usage.cost', response.usage.cost)
    }
  }
}

/**
 * Wraps `callModel` with OTel span instrumentation and then consumes
 * the response via `getResponse()`, capturing token usage attributes.
 *
 * Returns the full `OpenResponsesNonStreamingResponse` (not the lazy `ModelResult`).
 * Langfuse picks up these spans via `LangfuseSpanProcessor` and renders them
 * as generations. All calls within the same `withAgentTrace` share one traceId.
 */
export const tracedCallModel = <TTools extends readonly Tool[]>(
  request: CallModelInput<TTools>,
  options?: TracedCallModelOptions
): Effect.Effect<OpenResponsesNonStreamingResponse, AiError> => {
  const env = getAiEnv()
  const requestModel =
    typeof request.model === 'string' ? request.model : undefined
  const model = requestModel ?? env.OPENROUTER_MODEL
  const spanName = options?.stepName ?? `gen_ai.chat.completions ${model}`

  const requestTemperature =
    typeof request.temperature === 'number' ? request.temperature : undefined
  const requestMaxTokens =
    typeof request.maxOutputTokens === 'number' ? request.maxOutputTokens : undefined

  const attributes: Record<string, string | number> = {
    'gen_ai.system': 'openrouter',
    'gen_ai.request.model': model
  }
  if (requestTemperature !== undefined) {
    attributes['gen_ai.request.temperature'] = requestTemperature
  }
  if (requestMaxTokens !== undefined) {
    attributes['gen_ai.request.max_tokens'] = requestMaxTokens
  }

  return withTracedSpan(
    spanName,
    { kind: SpanKind.CLIENT, attributes },
    (span) =>
      Effect.gen(function* () {
        const modelResult = yield* callModel(request)
        const response = yield* Effect.tryPromise({
          try: () => modelResult.getResponse(),
          catch: (error) => new AiError({ message: String(error) })
        })
        setUsageAttributes(span, response)
        return response
      })
  )
}

/**
 * Creates a named agent step span around an Effect computation.
 * All traced calls (including `tracedCallModel`) inside the provided
 * effect will appear as children of this span in Langfuse, sharing
 * the same traceId.
 */
export const withAgentStep = <A, E>(
  name: string,
  metadata: Record<string, string>,
  fn: Effect.Effect<A, E>
): Effect.Effect<A, E> =>
  withTracedSpan(
    name,
    {
      attributes: {
        'agent.step': name,
        ...Object.fromEntries(
          Object.entries(metadata).map(([k, v]) => [
            `agent.metadata.${k}`,
            v
          ])
        )
      }
    },
    () => fn
  )

/**
 * Wraps an entire multi-agent run in a root trace span.
 * All nested `withAgentStep` and `tracedCallModel` calls will be
 * parented under this span, sharing the same traceId in Langfuse.
 */
export const withAgentTrace = <A, E>(
  name: string,
  metadata: Record<string, string>,
  fn: Effect.Effect<A, E>
): Effect.Effect<A, E> =>
  withTracedSpan(
    name,
    {
      attributes: {
        'agent.type': 'multi-step',
        ...Object.fromEntries(
          Object.entries(metadata).map(([k, v]) => [
            `agent.metadata.${k}`,
            v
          ])
        )
      }
    },
    () => fn
  )
