const defaultServiceName = 'tx-agent-kit'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const validLogLevels: readonly string[] = ['debug', 'info', 'warn', 'error']

const getDefaultLogLevel = (): LogLevel => {
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  return nodeEnv === 'development' || nodeEnv === 'test' ? 'debug' : 'warn'
}

export interface LoggingEnv {
  SERVICE_NAME: string
  LOG_LEVEL: LogLevel
}

export const getLoggingEnv = (): LoggingEnv => {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  const logLevel = raw && validLogLevels.includes(raw) ? (raw as LogLevel) : getDefaultLogLevel()

  return {
    SERVICE_NAME: process.env.SERVICE_NAME ?? defaultServiceName,
    LOG_LEVEL: logLevel
  }
}
