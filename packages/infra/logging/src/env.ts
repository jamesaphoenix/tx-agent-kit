const defaultServiceName = 'tx-agent-kit'

export interface LoggingEnv {
  SERVICE_NAME: string
}

export const getLoggingEnv = (): LoggingEnv => {
  return {
    SERVICE_NAME: process.env.SERVICE_NAME ?? defaultServiceName
  }
}
