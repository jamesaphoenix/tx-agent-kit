export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

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

const writeLog = (entry: StructuredLogEntry): void => {
  process.stdout.write(`${JSON.stringify(entry)}\n`)
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

export const createLogger = (service: string, baseContext: LogContext = {}): StructuredLogger => {
  const log = (level: LogLevel, message: string, context?: LogContext, error?: Error): void => {
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
      })
    }
  }
}

export const defaultLogger = createLogger(process.env.SERVICE_NAME ?? 'tx-agent-kit')
