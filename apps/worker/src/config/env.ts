const defaultTemporalRuntimeMode = 'cli'
const defaultTemporalAddress = 'localhost:7233'
const defaultTemporalNamespace = 'default'
const defaultTemporalTaskQueue = 'tx-agent-kit'
const defaultEmailCampaignsTaskQueue = 'email-campaigns'
const defaultNodeEnv = 'development'

const runtimeModes = ['cli', 'cloud'] as const

export type TemporalRuntimeMode = (typeof runtimeModes)[number]

export interface WorkerEnv {
  NODE_ENV: string
  DATABASE_URL: string
  WORKER_ENABLE_SCHEDULES: boolean
  OUTBOX_POLL_BATCH_SIZE: number
  /**
   * Backstop sweep cadence for the event-driven outbox dispatcher. The dispatcher
   * is woken by Postgres NOTIFY; this timer is the safety net that catches any
   * missed notification. Cheap (a lock-free DB read), so a low value is fine.
   */
  OUTBOX_BACKSTOP_INTERVAL_SECONDS: number
  /**
   * Postgres connection string for the dispatcher's LISTEN session. MUST be a
   * direct / session-mode connection (never a transaction pooler — LISTEN is
   * per-session). Falls back to `DATABASE_URL` when unset.
   */
  OUTBOX_LISTENER_DATABASE_URL: string
  OUTBOX_STUCK_THRESHOLD_MINUTES: number
  OUTBOX_PRUNE_RETENTION_DAYS: number
  /**
   * Age in seconds after which an unclosed credit reservation is considered
   * orphaned and reclaimed by the scheduled workflow.
   *
   * @spec INV-BILLING-003
   */
  RESERVATION_RECLAIM_MAX_AGE_SECONDS: number
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
  SENTRY_SPOTLIGHT: boolean
  RESEND_API_KEY: string | undefined
  RESEND_FROM_EMAIL: string | undefined
  WEB_BASE_URL: string | undefined
  EMAIL_CAMPAIGNS_TASK_QUEUE: string
  /**
   * Stripe API key used for off-session auto-recharge PaymentIntents
   * fired by the billing worker. Leave undefined in dev/test — the
   * worker's StripePortLive will fall back to a `pi_local_*` stub so
   * integration tests pass without a real Stripe client.
   *
   * @spec billing-and-pricing-design
   */
  STRIPE_SECRET_KEY: string | undefined
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

const parsePositiveIntegerEnv = (
  name: string,
  value: string | undefined,
  fallback: number
): number => {
  if (typeof value === 'undefined' || value.trim().length === 0) {
    return fallback
  }

  const normalized = value.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} must be a positive integer, got ${value}`)
  }

  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer, got ${value}`)
  }

  return parsed
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

/**
 * Lightweight accessor for `STRIPE_SECRET_KEY` that does not pull in the
 * full {@link getWorkerEnv} validation chain (which requires
 * `DATABASE_URL`). Used by the worker-side Stripe client so test contexts
 * that omit `DATABASE_URL` can still resolve a `null` stub without
 * crashing.
 *
 * Returns `undefined` when the secret is unset OR blank.
 */
export const getWorkerStripeSecretKey = (): string | undefined => {
  const value = process.env.STRIPE_SECRET_KEY
  if (typeof value === 'undefined') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Lightweight accessor for links generated inside worker activities.
 * Avoids pulling the full worker validation chain into leaf modules that
 * only need the optional web origin.
 */
export const getWorkerWebBaseUrl = (): string | undefined =>
  parseOptionalStringEnv(process.env.WEB_BASE_URL)

export const getWorkerEnv = (): WorkerEnv => {
  if (_cachedWorkerEnv) {
    return _cachedWorkerEnv
  }

  const runtimeMode = parseTemporalRuntimeMode(process.env.TEMPORAL_RUNTIME_MODE)
  const defaults = resolveRuntimeModeDefaults(runtimeMode)
  const nodeEnv = process.env.NODE_ENV ?? defaultNodeEnv

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required for the worker to connect to the outbox table')
  }

  const resolvedBatchSize = parsePositiveIntegerEnv(
    'OUTBOX_POLL_BATCH_SIZE',
    process.env.OUTBOX_POLL_BATCH_SIZE,
    50
  )

  const resolvedBackstopInterval = parsePositiveIntegerEnv(
    'OUTBOX_BACKSTOP_INTERVAL_SECONDS',
    process.env.OUTBOX_BACKSTOP_INTERVAL_SECONDS,
    10
  )

  const resolvedListenerDatabaseUrl =
    parseOptionalStringEnv(process.env.OUTBOX_LISTENER_DATABASE_URL) ?? databaseUrl

  const resolvedStuckThreshold = parsePositiveIntegerEnv(
    'OUTBOX_STUCK_THRESHOLD_MINUTES',
    process.env.OUTBOX_STUCK_THRESHOLD_MINUTES,
    5
  )

  const resolvedPruneRetention = parsePositiveIntegerEnv(
    'OUTBOX_PRUNE_RETENTION_DAYS',
    process.env.OUTBOX_PRUNE_RETENTION_DAYS,
    30
  )

  // @spec INV-BILLING-003 — orphan reservation reclaim timeout (2h default).
  const resolvedReservationReclaimMaxAge = parsePositiveIntegerEnv(
    'RESERVATION_RECLAIM_MAX_AGE_SECONDS',
    process.env.RESERVATION_RECLAIM_MAX_AGE_SECONDS,
    7200
  )

  const env: WorkerEnv = {
    NODE_ENV: nodeEnv,
    DATABASE_URL: databaseUrl,
    WORKER_ENABLE_SCHEDULES: parseBooleanEnv(
      process.env.WORKER_ENABLE_SCHEDULES,
      nodeEnv !== 'test'
    ),
    OUTBOX_POLL_BATCH_SIZE: resolvedBatchSize,
    OUTBOX_BACKSTOP_INTERVAL_SECONDS: resolvedBackstopInterval,
    OUTBOX_LISTENER_DATABASE_URL: resolvedListenerDatabaseUrl,
    OUTBOX_STUCK_THRESHOLD_MINUTES: resolvedStuckThreshold,
    OUTBOX_PRUNE_RETENTION_DAYS: resolvedPruneRetention,
    RESERVATION_RECLAIM_MAX_AGE_SECONDS: resolvedReservationReclaimMaxAge,
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
    SENTRY_SPOTLIGHT: parseBooleanEnv(process.env.SENTRY_SPOTLIGHT, false),
    RESEND_API_KEY: parseOptionalStringEnv(process.env.RESEND_API_KEY),
    RESEND_FROM_EMAIL: parseOptionalStringEnv(process.env.RESEND_FROM_EMAIL),
    WEB_BASE_URL: parseOptionalStringEnv(process.env.WEB_BASE_URL),
    EMAIL_CAMPAIGNS_TASK_QUEUE: process.env.EMAIL_CAMPAIGNS_TASK_QUEUE ?? defaultEmailCampaignsTaskQueue,
    STRIPE_SECRET_KEY: parseOptionalStringEnv(process.env.STRIPE_SECRET_KEY)
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
