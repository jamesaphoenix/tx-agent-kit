const defaultTemporalRuntimeMode = 'cli'
const defaultTemporalAddress = 'localhost:7233'
const defaultTemporalNamespace = 'default'
const defaultTemporalTaskQueue = 'tx-agent-kit'
const defaultNodeEnv = 'development'

const runtimeModes = ['cli', 'cloud'] as const

export type TemporalRuntimeMode = (typeof runtimeModes)[number]

export interface WorkerEnv {
  NODE_ENV: string
  DATABASE_URL: string
  OUTBOX_POLL_BATCH_SIZE: number
  OUTBOX_STUCK_THRESHOLD_MINUTES: number
  OUTBOX_PRUNE_RETENTION_DAYS: number
  TEMPORAL_RUNTIME_MODE: TemporalRuntimeMode
  TEMPORAL_ADDRESS: string
  TEMPORAL_NAMESPACE: string
  TEMPORAL_TASK_QUEUE: string
  TEMPORAL_API_KEY: string | undefined
  TEMPORAL_TLS_ENABLED: boolean
  TEMPORAL_TLS_SERVER_NAME: string | undefined
  TEMPORAL_TLS_CA_CERT_PEM: string | undefined
  TEMPORAL_TLS_CLIENT_CERT_PEM: string | undefined
  TEMPORAL_TLS_CLIENT_KEY_PEM: string | undefined
  WORKER_SENTRY_DSN: string | undefined
  RESEND_API_KEY: string | undefined
  RESEND_FROM_EMAIL: string | undefined
  WEB_BASE_URL: string | undefined
}

export interface WorkerTemporalTlsOptions {
  serverNameOverride?: string
  serverRootCACertificate?: Buffer
  clientCertPair?: {
    crt: Buffer
    key: Buffer
  }
}

export interface WorkerTemporalConnectionOptions {
  readonly address: string
  readonly tls?: boolean | WorkerTemporalTlsOptions
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

const parseOptionalStringEnv = (value: string | undefined): string | undefined => {
  if (typeof value === 'undefined') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

const normalizePemValue = (value: string | undefined): string | undefined => {
  if (typeof value === 'undefined') {
    return undefined
  }

  return value.replaceAll('\\n', '\n')
}

const resolveRuntimeModeDefaults = (
  runtimeMode: TemporalRuntimeMode
): { tlsEnabledDefault: boolean } => ({
  tlsEnabledDefault: runtimeMode === 'cloud'
})

const validateWorkerEnv = (env: WorkerEnv): void => {
  const hasClientCert = Boolean(env.TEMPORAL_TLS_CLIENT_CERT_PEM)
  const hasClientKey = Boolean(env.TEMPORAL_TLS_CLIENT_KEY_PEM)
  if (hasClientCert !== hasClientKey) {
    throw new Error(
      'TEMPORAL_TLS_CLIENT_CERT_PEM and TEMPORAL_TLS_CLIENT_KEY_PEM must both be provided when either is set'
    )
  }

  const tlsMaterialConfigured = Boolean(
    env.TEMPORAL_TLS_SERVER_NAME ??
      env.TEMPORAL_TLS_CA_CERT_PEM ??
      (hasClientCert && hasClientKey)
  )

  if (tlsMaterialConfigured && !env.TEMPORAL_TLS_ENABLED) {
    throw new Error(
      'TEMPORAL_TLS_ENABLED must be true when TLS server name or TLS certificate material is configured'
    )
  }

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

let _cachedWorkerEnv: WorkerEnv | null = null

export const resetWorkerEnvCache = (): void => {
  _cachedWorkerEnv = null
}

export const getWorkerEnv = (): WorkerEnv => {
  if (_cachedWorkerEnv) {
    return _cachedWorkerEnv
  }

  const runtimeMode = parseTemporalRuntimeMode(process.env.TEMPORAL_RUNTIME_MODE)
  const defaults = resolveRuntimeModeDefaults(runtimeMode)

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required for the worker to connect to the outbox table')
  }

  const outboxBatchSize = process.env.OUTBOX_POLL_BATCH_SIZE
    ? Number.parseInt(process.env.OUTBOX_POLL_BATCH_SIZE, 10)
    : 50

  const resolvedBatchSize = Number.isNaN(outboxBatchSize) ? 50 : outboxBatchSize
  if (resolvedBatchSize <= 0) {
    throw new Error(
      `OUTBOX_POLL_BATCH_SIZE must be a positive integer, got ${resolvedBatchSize}`
    )
  }

  const stuckThresholdMinutes = process.env.OUTBOX_STUCK_THRESHOLD_MINUTES
    ? Number.parseInt(process.env.OUTBOX_STUCK_THRESHOLD_MINUTES, 10)
    : 5
  const resolvedStuckThreshold = Number.isNaN(stuckThresholdMinutes) ? 5 : stuckThresholdMinutes
  if (resolvedStuckThreshold <= 0) {
    throw new Error(
      `OUTBOX_STUCK_THRESHOLD_MINUTES must be a positive integer, got ${resolvedStuckThreshold}`
    )
  }

  const pruneRetentionDays = process.env.OUTBOX_PRUNE_RETENTION_DAYS
    ? Number.parseInt(process.env.OUTBOX_PRUNE_RETENTION_DAYS, 10)
    : 30
  const resolvedPruneRetention = Number.isNaN(pruneRetentionDays) ? 30 : pruneRetentionDays
  if (resolvedPruneRetention <= 0) {
    throw new Error(
      `OUTBOX_PRUNE_RETENTION_DAYS must be a positive integer, got ${resolvedPruneRetention}`
    )
  }

  const env: WorkerEnv = {
    NODE_ENV: process.env.NODE_ENV ?? defaultNodeEnv,
    DATABASE_URL: databaseUrl,
    OUTBOX_POLL_BATCH_SIZE: resolvedBatchSize,
    OUTBOX_STUCK_THRESHOLD_MINUTES: resolvedStuckThreshold,
    OUTBOX_PRUNE_RETENTION_DAYS: resolvedPruneRetention,
    TEMPORAL_RUNTIME_MODE: runtimeMode,
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? defaultTemporalAddress,
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? defaultTemporalNamespace,
    TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? defaultTemporalTaskQueue,
    TEMPORAL_API_KEY: parseOptionalStringEnv(process.env.TEMPORAL_API_KEY),
    TEMPORAL_TLS_ENABLED: parseBooleanEnv(
      process.env.TEMPORAL_TLS_ENABLED,
      defaults.tlsEnabledDefault
    ),
    TEMPORAL_TLS_SERVER_NAME: parseOptionalStringEnv(process.env.TEMPORAL_TLS_SERVER_NAME),
    TEMPORAL_TLS_CA_CERT_PEM: normalizePemValue(
      parseOptionalStringEnv(process.env.TEMPORAL_TLS_CA_CERT_PEM)
    ),
    TEMPORAL_TLS_CLIENT_CERT_PEM: normalizePemValue(
      parseOptionalStringEnv(process.env.TEMPORAL_TLS_CLIENT_CERT_PEM)
    ),
    TEMPORAL_TLS_CLIENT_KEY_PEM: normalizePemValue(
      parseOptionalStringEnv(process.env.TEMPORAL_TLS_CLIENT_KEY_PEM)
    ),
    WORKER_SENTRY_DSN: parseOptionalStringEnv(process.env.WORKER_SENTRY_DSN),
    RESEND_API_KEY: parseOptionalStringEnv(process.env.RESEND_API_KEY),
    RESEND_FROM_EMAIL: parseOptionalStringEnv(process.env.RESEND_FROM_EMAIL),
    WEB_BASE_URL: parseOptionalStringEnv(process.env.WEB_BASE_URL)
  }

  validateWorkerEnv(env)
  _cachedWorkerEnv = env
  return _cachedWorkerEnv
}

const resolveTemporalTlsOptions = (
  env: WorkerEnv
): boolean | WorkerTemporalTlsOptions => {
  const tlsOptions: WorkerTemporalTlsOptions = {}

  if (env.TEMPORAL_TLS_SERVER_NAME) {
    tlsOptions.serverNameOverride = env.TEMPORAL_TLS_SERVER_NAME
  }

  if (env.TEMPORAL_TLS_CA_CERT_PEM) {
    tlsOptions.serverRootCACertificate = Buffer.from(env.TEMPORAL_TLS_CA_CERT_PEM)
  }

  if (env.TEMPORAL_TLS_CLIENT_CERT_PEM && env.TEMPORAL_TLS_CLIENT_KEY_PEM) {
    tlsOptions.clientCertPair = {
      crt: Buffer.from(env.TEMPORAL_TLS_CLIENT_CERT_PEM),
      key: Buffer.from(env.TEMPORAL_TLS_CLIENT_KEY_PEM)
    }
  }

  return Object.keys(tlsOptions).length === 0 ? true : tlsOptions
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
            tls: resolveTemporalTlsOptions(env)
          }
        : {})
    }
  }

  if (env.TEMPORAL_TLS_ENABLED) {
    return {
      ...connectionOptions,
      tls: resolveTemporalTlsOptions(env)
    }
  }

  return connectionOptions
}
