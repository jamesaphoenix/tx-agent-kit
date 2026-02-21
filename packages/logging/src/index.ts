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

export const toErrorDetails = (error: unknown): LogContext => {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string | number }

    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      ...(errorWithCode.code !== undefined ? { errorCode: errorWithCode.code } : {})
    }
  }

  return {
    errorMessage: String(error),
    errorType: typeof error
  }
}

export const logError = (
  logger: StructuredLogger,
  error: unknown,
  context: string,
  metadata?: LogContext
): void => {
  logger.error(
    `Error in ${context}`,
    {
      event: 'error',
      context,
      ...toErrorDetails(error),
      ...(metadata ?? {})
    },
    error instanceof Error ? error : undefined
  )
}

export const logProgress = (
  logger: StructuredLogger,
  progress: number,
  step: string,
  metadata?: LogContext
): void => {
  logger.info(`Progress: ${progress}% - ${step}`, {
    event: 'progress',
    progress: Math.max(0, Math.min(100, progress)),
    step,
    ...(metadata ?? {})
  })
}

export const logStateChange = (
  logger: StructuredLogger,
  fromState: string,
  toState: string,
  metadata?: LogContext
): void => {
  logger.info(`State changed from ${fromState} to ${toState}`, {
    event: 'state_change',
    previousState: fromState,
    newState: toState,
    ...(metadata ?? {})
  })
}

export const logPerformance = (
  logger: StructuredLogger,
  operation: string,
  durationMs: number,
  metadata?: LogContext
): void => {
  logger.info(`${operation} completed in ${durationMs}ms`, {
    event: 'performance',
    operation,
    durationMs,
    durationSeconds: Number((durationMs / 1000).toFixed(3)),
    ...(metadata ?? {})
  })
}

export const createPerfLogger = (
  logger: StructuredLogger,
  operation: string,
  baseMetadata?: LogContext
): {
  end: (metadata?: LogContext) => void
} => {
  const startedAt = Date.now()

  return {
    end: (metadata) => {
      const durationMs = Date.now() - startedAt
      logPerformance(logger, operation, durationMs, {
        ...(baseMetadata ?? {}),
        ...(metadata ?? {})
      })
    }
  }
}

export const defaultLogger = createLogger(process.env.SERVICE_NAME ?? 'tx-agent-kit')
