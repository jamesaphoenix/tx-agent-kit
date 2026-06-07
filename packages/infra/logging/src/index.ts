import { trace } from '@opentelemetry/api'
import { logs, SeverityNumber, type AnyValue, type AnyValueMap } from '@opentelemetry/api-logs'
import { getLoggingEnv } from './env.js'

export type { LogLevel } from './env.js'

import type { LogLevel } from './env.js'

export interface LogContext {
  [key: string]: unknown
}

export interface StructuredLogEntry {
  timestamp: string
  level: LogLevel
  service: string
  message: string
  trace_id?: string
  span_id?: string
  trace_flags?: number
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

export interface StructuredLogger {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext, error?: Error) => void
  child: (scope: string, context?: LogContext) => StructuredLogger
}

const severityNumberByLevel: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR
}

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const stringifyLogEntry = (entry: StructuredLogEntry): string => {
  const seen = new WeakSet()

  return JSON.stringify(entry, (_key, value: unknown) => {
    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }

    return value
  })
}

const normalizeAttributeValue = (value: unknown): AnyValue | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  return safeJsonStringify(value)
}

const toLogRecordAttributes = (entry: StructuredLogEntry): AnyValueMap => {
  const attributes: AnyValueMap = {
    'service.name': entry.service,
    'log.level': entry.level
  }

  if (entry.trace_id) {
    attributes.trace_id = entry.trace_id
  }

  if (entry.span_id) {
    attributes.span_id = entry.span_id
  }

  if (entry.trace_flags !== undefined) {
    attributes.trace_flags = entry.trace_flags
  }

  if (entry.context) {
    for (const [key, value] of Object.entries(entry.context)) {
      const normalizedValue = normalizeAttributeValue(value)
      if (normalizedValue !== undefined) {
        attributes[`context.${key}`] = normalizedValue
      }
    }
  }

  if (entry.error) {
    attributes['error.name'] = entry.error.name
    attributes['error.message'] = entry.error.message
    if (entry.error.stack) {
      attributes['error.stack'] = entry.error.stack
    }
  }

  return attributes
}

const emitOtelLogRecord = (entry: StructuredLogEntry): void => {
  try {
    logs.getLogger(entry.service).emit({
      severityNumber: severityNumberByLevel[entry.level],
      severityText: entry.level.toUpperCase(),
      body: entry.message,
      attributes: toLogRecordAttributes(entry),
      timestamp: new Date(entry.timestamp)
    })
  } catch (error) {
    process.stderr.write(
      `[tx-agent-kit/logging] failed to emit OTEL log record: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    )
  }
}

const writeLog = (entry: StructuredLogEntry): void => {
  process.stdout.write(`${stringifyLogEntry(entry)}\n`)
  emitOtelLogRecord(entry)
}

const withScope = (service: string, scope: string): string => `${service}:${scope}`

/**
 * The single place we read OTEL trace correlation from the active span. Shared
 * by the structured logger AND the Sentry reporter
 * (`@tx-agent-kit/observability/sentry`) so log entries and Sentry issues link
 * to the SAME trace, resolved the SAME way. Returns undefined when there is no
 * active span with a valid (non-empty) trace id. Lives here because logging is
 * the lowest layer that needs it; observability depends on logging, not the
 * reverse.
 */
export const getActiveSpanContext = ():
  | { traceId: string; spanId: string; traceFlags: number }
  | undefined => {
  try {
    const spanContext = trace.getActiveSpan()?.spanContext()
    if (!spanContext?.traceId) {
      return undefined
    }
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags
    }
  } catch {
    return undefined
  }
}

const getActiveTraceFields = (): Pick<StructuredLogEntry, 'trace_id' | 'span_id' | 'trace_flags'> => {
  const spanContext = getActiveSpanContext()

  if (!spanContext) {
    return {}
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags
  }
}

const createEntry = (
  service: string,
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): StructuredLogEntry => {
  return {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...getActiveTraceFields(),
    context,
    error: error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      : undefined
  }
}

export const createLogger = (
  service: string,
  baseContext: LogContext = {},
  minLevel?: LogLevel
): StructuredLogger => {
  const threshold = minLevel ?? getLoggingEnv().LOG_LEVEL

  const log = (level: LogLevel, message: string, context?: LogContext, error?: Error): void => {
    if (levelPriority[level] < levelPriority[threshold]) {
      return
    }

    try {
      writeLog(
        createEntry(
          service,
          level,
          message,
          {
            ...baseContext,
            ...(context ?? {})
          },
          error
        )
      )
    } catch (loggingError) {
      try {
        process.stderr.write(
          `[tx-agent-kit/logging] log emission failed: ${
            loggingError instanceof Error ? loggingError.message : String(loggingError)
          }\n`
        )
      } catch {
        // Last resort: logging must never crash the caller.
      }
    }
  }

  return {
    debug: (message, context) => {
      log('debug', message, context)
    },
    info: (message, context) => {
      log('info', message, context)
    },
    warn: (message, context) => {
      log('warn', message, context)
    },
    error: (message, context, error) => {
      log('error', message, context, error)
    },
    child: (scope, context = {}) => {
      return createLogger(withScope(service, scope), {
        ...baseContext,
        ...context
      }, threshold)
    }
  }
}

// Bridge that routes Effect.log* through the structured pipeline above.
// (Re-exported at the end so `createLogger` is initialized before the bridge
// module's top-level `createLogger` import resolves.)
export { makeEffectLoggerLayer } from './effect-logger.js'
