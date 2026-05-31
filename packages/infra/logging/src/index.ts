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
  process.stdout.write(`${JSON.stringify(entry)}\n`)
  emitOtelLogRecord(entry)
}

const withScope = (service: string, scope: string): string => `${service}:${scope}`

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
