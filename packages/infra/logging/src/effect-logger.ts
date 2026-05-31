import { Cause, type HashMap, Layer, type List, Logger, LogLevel, type LogSpan } from 'effect'
import { createLogger, type LogContext, type LogLevel as StructuredLevel } from './index.js'

/**
 * Bridges Effect's logging (`Effect.logError/logWarning/logInfo`) into the
 * structured `createLogger` pipeline.
 *
 * Domain/application code (packages/core) must not import a concrete logger, so
 * it uses `Effect.log*`. Without this bridge those calls fall to Effect's
 * DEFAULT logger — a different JSON shape (`logLevel`/`annotations`/`fiberId`,
 * no `service`/`trace_id`) that is NEVER exported to OTEL → invisible in
 * Loki/GMP. Installing this layer routes every `Effect.log*` through
 * `createLogger`, so it gets the identical schema, level mapping,
 * trace_id/span_id, LOG_LEVEL threshold, and OTEL export as the rest of the app.
 *
 * Install once per runtime via `makeEffectOtelLayer` (which already installs the
 * OTEL tracer that `createLogger`'s trace correlation reads from).
 */

const toStructuredLevel = (level: LogLevel.LogLevel): StructuredLevel | undefined => {
  switch (level._tag) {
    case 'Fatal':
    case 'Error':
      return 'error'
    case 'Warning':
      return 'warn'
    case 'Info':
      return 'info'
    case 'Debug':
    case 'Trace':
    case 'All':
      return 'debug'
    case 'None':
      return undefined
  }
}

// Effect log calls are variadic (`Effect.logWarning('msg', { path, cause })`):
// `message` is a single value or an array of parts. Keep string parts as the
// message text and fold plain-object parts into structured context, so
// multi-arg logs become first-class structured entries instead of one stringy
// blob. A bare Error part is promoted to the structured `error` field.
const splitMessage = (message: unknown): { text: string; context: LogContext; error?: Error } => {
  const parts = Array.isArray(message) ? message : [message]
  const texts: string[] = []
  const context: LogContext = {}
  let error: Error | undefined

  for (const part of parts) {
    if (typeof part === 'string') {
      texts.push(part)
    } else if (part instanceof Error) {
      error = error ?? part
    } else if (part !== null && typeof part === 'object') {
      Object.assign(context, part as Record<string, unknown>)
    } else if (part !== undefined) {
      texts.push(String(part))
    }
  }

  return { text: texts.join(' '), context, error }
}

const annotationsToContext = (annotations: HashMap.HashMap<string, unknown>): LogContext => {
  const context: LogContext = {}
  for (const [key, value] of annotations) {
    context[key] = value
  }
  return context
}

const spansToContext = (spans: List.List<LogSpan.LogSpan>, nowMs: number): LogContext => {
  const context: LogContext = {}
  for (const span of spans) {
    context[`logSpan.${span.label}`] = `${nowMs - span.startTime}ms`
  }
  return context
}

const errorFromCause = (cause: Cause.Cause<unknown>): Error | undefined => {
  if (Cause.isEmpty(cause)) {
    return undefined
  }
  const squashed = Cause.squash(cause)
  if (squashed instanceof Error) {
    return squashed
  }
  return new Error(typeof squashed === 'string' ? squashed : Cause.pretty(cause))
}

/**
 * Build a Layer that replaces Effect's default logger with one that emits
 * through `createLogger(service)`. Returns `Layer<never>` — merge it alongside
 * the OTEL tracer layer in the runtime composition.
 */
export const makeEffectLoggerLayer = (service: string): Layer.Layer<never> => {
  const structured = createLogger(service)

  const effectLogger = Logger.make((options) => {
    const level = toStructuredLevel(options.logLevel)
    if (level === undefined) {
      return
    }

    const message = splitMessage(options.message)
    const context: LogContext = {
      ...annotationsToContext(options.annotations),
      ...spansToContext(options.spans, options.date.getTime()),
      ...message.context
    }
    const error = errorFromCause(options.cause) ?? message.error

    if (level === 'error') {
      structured.error(message.text, context, error)
    } else {
      structured[level](message.text, error ? { ...context, error } : context)
    }
  })

  // Let EVERY Effect log reach the bridge (minimumLogLevel: All) and rely on
  // createLogger's LOG_LEVEL threshold as the SINGLE level gate — otherwise
  // Effect's default minimum (Info) would silently drop Effect.logDebug even
  // when LOG_LEVEL=debug, diverging from createLogger.debug.
  return Layer.merge(
    Logger.replace(Logger.defaultLogger, effectLogger),
    Logger.minimumLogLevel(LogLevel.All)
  )
}
