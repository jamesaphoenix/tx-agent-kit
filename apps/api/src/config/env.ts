import * as Schema from 'effect/Schema'

const requiredApiEnvShape = {
  NODE_ENV: Schema.String,
  API_PORT: Schema.String,
  API_HOST: Schema.String,
  DATABASE_URL: Schema.String,
  AUTH_SECRET: Schema.String,
  API_CORS_ORIGIN: Schema.String,
  AUTH_RATE_LIMIT_WINDOW_MS: Schema.optional(Schema.String),
  AUTH_RATE_LIMIT_MAX_REQUESTS: Schema.optional(Schema.String),
  RESEND_API_KEY: Schema.optional(Schema.String),
  RESEND_FROM_EMAIL: Schema.optional(Schema.String),
  WEB_BASE_URL: Schema.optional(Schema.String)
} as const

export const requiredApiEnvKeys = [
  'NODE_ENV',
  'API_PORT',
  'API_HOST',
  'DATABASE_URL',
  'AUTH_SECRET',
  'API_CORS_ORIGIN'
] as const

export const ApiEnvSchema = Schema.Struct(requiredApiEnvShape)
export type ApiEnv = Schema.Schema.Type<typeof ApiEnvSchema>

export const decodeApiEnv = Schema.decodeUnknownSync(ApiEnvSchema)

const parsePositiveInt = (rawValue: string | undefined, fallback: number): number => {
  if (!rawValue) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const assertApiEnvInvariants = (env: ApiEnv): ApiEnv => {
  const hasResendApiKey = typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.length > 0
  const hasResendFromEmail = typeof env.RESEND_FROM_EMAIL === 'string' && env.RESEND_FROM_EMAIL.length > 0
  const resendConfigured = hasResendApiKey || hasResendFromEmail

  if (env.NODE_ENV === 'production' && env.AUTH_SECRET === 'change-me-in-production') {
    throw new Error('AUTH_SECRET cannot use the default placeholder in production.')
  }

  if (resendConfigured && hasResendApiKey !== hasResendFromEmail) {
    throw new Error('RESEND_API_KEY and RESEND_FROM_EMAIL must be configured together.')
  }

  if (env.NODE_ENV === 'production' || resendConfigured) {
    if (!hasResendApiKey) {
      throw new Error('RESEND_API_KEY is required when Resend email sending is configured.')
    }

    if (!hasResendFromEmail) {
      throw new Error('RESEND_FROM_EMAIL is required when Resend email sending is configured.')
    }

    if (!env.WEB_BASE_URL) {
      throw new Error('WEB_BASE_URL is required when Resend email sending is configured.')
    }
  }

  return env
}

export const getApiEnv = (): ApiEnv =>
  assertApiEnvInvariants(decodeApiEnv(process.env))

export interface AuthRateLimitConfig {
  windowMs: number
  maxRequests: number
}

export const getAuthRateLimitConfig = (): AuthRateLimitConfig => {
  const env = getApiEnv()

  return {
    windowMs: parsePositiveInt(env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: parsePositiveInt(env.AUTH_RATE_LIMIT_MAX_REQUESTS, 15)
  }
}
