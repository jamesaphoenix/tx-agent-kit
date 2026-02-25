const defaultTemporalRuntimeMode = 'cli'
const defaultTemporalAddress = 'localhost:7233'
const defaultTemporalNamespace = 'default'
const defaultTemporalTaskQueue = 'tx-agent-kit'

const runtimeModes = ['cli', 'cloud'] as const

export type TemporalRuntimeMode = (typeof runtimeModes)[number]

export interface WorkerEnv {
  TEMPORAL_RUNTIME_MODE: TemporalRuntimeMode
  TEMPORAL_ADDRESS: string
  TEMPORAL_NAMESPACE: string
  TEMPORAL_TASK_QUEUE: string
  TEMPORAL_API_KEY: string | undefined
  TEMPORAL_TLS_ENABLED: boolean
  TEMPORAL_TLS_SERVER_NAME: string | undefined
}

export interface WorkerTemporalConnectionOptions {
  readonly address: string
  readonly tls?: boolean | { serverNameOverride: string }
  readonly apiKey?: string
}

const parseTemporalRuntimeMode = (
  value: string | undefined
): TemporalRuntimeMode => {
  const normalized = (value ?? defaultTemporalRuntimeMode).trim().toLowerCase()
  if (runtimeModes.includes(normalized as TemporalRuntimeMode)) {
    return normalized as TemporalRuntimeMode
  }

  throw new Error(
    `Invalid TEMPORAL_RUNTIME_MODE '${value ?? ''}'. Expected one of: ${runtimeModes.join(', ')}`
  )
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (typeof value === 'undefined') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false
  }

  throw new Error(`Invalid boolean value '${value}'`)
}

const resolveRuntimeModeDefaults = (
  runtimeMode: TemporalRuntimeMode
): { tlsEnabledDefault: boolean } => ({
  tlsEnabledDefault: runtimeMode === 'cloud'
})

const validateWorkerEnv = (env: WorkerEnv): void => {
  if (env.TEMPORAL_RUNTIME_MODE !== 'cloud') {
    return
  }

  if (!env.TEMPORAL_API_KEY || env.TEMPORAL_API_KEY.trim().length === 0) {
    throw new Error(
      'TEMPORAL_API_KEY is required when TEMPORAL_RUNTIME_MODE=cloud'
    )
  }

  if (!env.TEMPORAL_TLS_ENABLED) {
    throw new Error(
      'TEMPORAL_TLS_ENABLED must be true when TEMPORAL_RUNTIME_MODE=cloud'
    )
  }
}

export const getWorkerEnv = (): WorkerEnv => {
  const runtimeMode = parseTemporalRuntimeMode(process.env.TEMPORAL_RUNTIME_MODE)
  const defaults = resolveRuntimeModeDefaults(runtimeMode)

  const env: WorkerEnv = {
    TEMPORAL_RUNTIME_MODE: runtimeMode,
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? defaultTemporalAddress,
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? defaultTemporalNamespace,
    TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? defaultTemporalTaskQueue,
    TEMPORAL_API_KEY:
      process.env.TEMPORAL_API_KEY && process.env.TEMPORAL_API_KEY.trim().length > 0
        ? process.env.TEMPORAL_API_KEY
        : undefined,
    TEMPORAL_TLS_ENABLED: parseBooleanEnv(
      process.env.TEMPORAL_TLS_ENABLED,
      defaults.tlsEnabledDefault
    ),
    TEMPORAL_TLS_SERVER_NAME:
      process.env.TEMPORAL_TLS_SERVER_NAME &&
      process.env.TEMPORAL_TLS_SERVER_NAME.trim().length > 0
        ? process.env.TEMPORAL_TLS_SERVER_NAME
        : undefined
  }

  validateWorkerEnv(env)
  return env
}

export const resolveWorkerTemporalConnectionOptions = (
  env: WorkerEnv
): WorkerTemporalConnectionOptions => {
  const connectionOptions: WorkerTemporalConnectionOptions = {
    address: env.TEMPORAL_ADDRESS
  }

  if (env.TEMPORAL_API_KEY) {
    return {
      ...connectionOptions,
      apiKey: env.TEMPORAL_API_KEY,
      ...(env.TEMPORAL_TLS_ENABLED
        ? {
            tls: env.TEMPORAL_TLS_SERVER_NAME
              ? { serverNameOverride: env.TEMPORAL_TLS_SERVER_NAME }
              : true
          }
        : {})
    }
  }

  if (env.TEMPORAL_TLS_ENABLED) {
    return {
      ...connectionOptions,
      tls: env.TEMPORAL_TLS_SERVER_NAME
        ? { serverNameOverride: env.TEMPORAL_TLS_SERVER_NAME }
        : true
    }
  }

  return connectionOptions
}
