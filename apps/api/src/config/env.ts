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
  AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS: Schema.optional(Schema.String),
  RESEND_API_KEY: Schema.optional(Schema.String),
  RESEND_FROM_EMAIL: Schema.optional(Schema.String),
  WEB_BASE_URL: Schema.optional(Schema.String),
  GOOGLE_OIDC_ISSUER_URL: Schema.optional(Schema.String),
  GOOGLE_OIDC_CLIENT_ID: Schema.optional(Schema.String),
  GOOGLE_OIDC_CLIENT_SECRET: Schema.optional(Schema.String),
  GOOGLE_OIDC_CALLBACK_URL: Schema.optional(Schema.String),
  STRIPE_SECRET_KEY: Schema.optional(Schema.String),
  STRIPE_WEBHOOK_SECRET: Schema.optional(Schema.String),
  STRIPE_PRO_PRICE_ID: Schema.optional(Schema.String),
  STRIPE_PRO_METERED_PRICE_ID: Schema.optional(Schema.String),
  SUBSCRIPTION_GUARD_ENABLED: Schema.optional(Schema.String)
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

  const stripeConfigured =
    typeof env.STRIPE_SECRET_KEY === 'string' && env.STRIPE_SECRET_KEY.length > 0
  const hasProPriceId =
    typeof env.STRIPE_PRO_PRICE_ID === 'string' && env.STRIPE_PRO_PRICE_ID.length > 0
  const hasMeteredPriceId =
    typeof env.STRIPE_PRO_METERED_PRICE_ID === 'string' && env.STRIPE_PRO_METERED_PRICE_ID.length > 0

  if (stripeConfigured && (!hasProPriceId || !hasMeteredPriceId)) {
    throw new Error('STRIPE_PRO_PRICE_ID and STRIPE_PRO_METERED_PRICE_ID are required when Stripe is configured.')
  }

  const googleOidcValues = [
    env.GOOGLE_OIDC_ISSUER_URL,
    env.GOOGLE_OIDC_CLIENT_ID,
    env.GOOGLE_OIDC_CLIENT_SECRET,
    env.GOOGLE_OIDC_CALLBACK_URL
  ]
  const configuredGoogleOidcValues = googleOidcValues.filter(
    (value) => typeof value === 'string' && value.length > 0
  )
  if (configuredGoogleOidcValues.length > 0 && configuredGoogleOidcValues.length < googleOidcValues.length) {
    throw new Error(
      'GOOGLE_OIDC_ISSUER_URL, GOOGLE_OIDC_CLIENT_ID, GOOGLE_OIDC_CLIENT_SECRET, and GOOGLE_OIDC_CALLBACK_URL must be configured together.'
    )
  }

  if (env.NODE_ENV === 'production' && configuredGoogleOidcValues.length < googleOidcValues.length) {
    throw new Error('Google OIDC variables are required in production.')
  }

  return env
}

export const getApiEnv = (): ApiEnv =>
  assertApiEnvInvariants(decodeApiEnv(process.env))

export interface AuthRateLimitConfig {
  windowMs: number
  maxIpRequests: number
  maxIdentifierRequests: number
}

export const getAuthRateLimitConfig = (): AuthRateLimitConfig => {
  const env = getApiEnv()
  const maxIpRequests = parsePositiveInt(env.AUTH_RATE_LIMIT_MAX_REQUESTS, 15)
  const maxIdentifierRequests = parsePositiveInt(
    env.AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS,
    maxIpRequests
  )

  return {
    windowMs: parsePositiveInt(env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
    maxIpRequests,
    maxIdentifierRequests
  }
}

export interface GoogleOidcConfig {
  issuerUrl: string
  clientId: string
  clientSecret: string
  callbackUrl: string
}

export const getGoogleOidcConfig = (): GoogleOidcConfig | null => {
  const env = getApiEnv()

  if (
    !env.GOOGLE_OIDC_ISSUER_URL ||
    !env.GOOGLE_OIDC_CLIENT_ID ||
    !env.GOOGLE_OIDC_CLIENT_SECRET ||
    !env.GOOGLE_OIDC_CALLBACK_URL
  ) {
    return null
  }

  return {
    issuerUrl: env.GOOGLE_OIDC_ISSUER_URL,
    clientId: env.GOOGLE_OIDC_CLIENT_ID,
    clientSecret: env.GOOGLE_OIDC_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_OIDC_CALLBACK_URL
  }
}

export const getSubscriptionGuardEnabled = (): boolean => {
  const env = getApiEnv()
  const rawValue = env.SUBSCRIPTION_GUARD_ENABLED

  if (rawValue === undefined) {
    return true
  }

  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0') {
    return false
  }

  return true
}
