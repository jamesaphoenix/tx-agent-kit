import {
  authRefreshTokenKey,
  getDefaultAuthRateLimitPolicy,
  type AuthRateLimitedPath,
  type AuthRateLimitPolicy
} from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'

const requiredApiEnvShape = {
  NODE_ENV: Schema.String,
  API_PORT: Schema.String,
  API_HOST: Schema.String,
  DATABASE_URL: Schema.String,
  REDIS_URL: Schema.optional(Schema.String),
  AUTH_SECRET: Schema.String,
  API_CORS_ORIGIN: Schema.String,
  AUTH_RATE_LIMIT_WINDOW_MS: Schema.optional(Schema.String),
  AUTH_RATE_LIMIT_MAX_REQUESTS: Schema.optional(Schema.String),
  AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS: Schema.optional(Schema.String),
  AUTH_RATE_LIMIT_BYPASS_TOKEN: Schema.optional(Schema.String),
  TURNSTILE_SECRET_KEY: Schema.optional(Schema.String),
  TURNSTILE_VERIFY_URL: Schema.optional(Schema.String),
  RESEND_API_KEY: Schema.optional(Schema.String),
  RESEND_FROM_EMAIL: Schema.optional(Schema.String),
  WEB_BASE_URL: Schema.optional(Schema.String),
  GOOGLE_OIDC_ISSUER_URL: Schema.optional(Schema.String),
  GOOGLE_OIDC_CLIENT_ID: Schema.optional(Schema.String),
  GOOGLE_OIDC_CLIENT_SECRET: Schema.optional(Schema.String),
  GOOGLE_OIDC_CALLBACK_URL: Schema.optional(Schema.String),
  STRIPE_SECRET_KEY: Schema.optional(Schema.String),
  STRIPE_WEBHOOK_SECRET: Schema.optional(Schema.String),
  RESEND_WEBHOOK_SECRET: Schema.optional(Schema.String),
  STRIPE_TRY_ME_PRICE_ID: Schema.optional(Schema.String),
  STRIPE_PRO_PRICE_ID: Schema.optional(Schema.String),
  STRIPE_AGENCY_PRICE_ID: Schema.optional(Schema.String),
  SUBSCRIPTION_GUARD_ENABLED: Schema.optional(Schema.String),
  TRUST_PROXY: Schema.optional(Schema.String),
  API_SENTRY_DSN: Schema.optional(Schema.String),
  SENTRY_SPOTLIGHT: Schema.optional(Schema.String)
} as const

const authRefreshCookieName = authRefreshTokenKey
const authRefreshCookieMaxAgeMs = 30 * 24 * 60 * 60 * 1000

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

const parseOptionalPositiveInt = (rawValue: string | undefined): number | undefined => {
  if (!rawValue) {
    return undefined
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined
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

  if (env.NODE_ENV === 'production' && env.AUTH_SECRET.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters (256 bits) in production.')
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
  const hasWebhookSecret =
    typeof env.STRIPE_WEBHOOK_SECRET === 'string' && env.STRIPE_WEBHOOK_SECRET.length > 0
  const isProductionLike = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging'
  if (stripeConfigured && isProductionLike && !hasWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required in production and staging when Stripe is configured.')
  }

  const hasResendWebhookSecret =
    typeof env.RESEND_WEBHOOK_SECRET === 'string' && env.RESEND_WEBHOOK_SECRET.length > 0
  if (resendConfigured && isProductionLike && !hasResendWebhookSecret) {
    throw new Error('RESEND_WEBHOOK_SECRET is required in production and staging when Resend is configured.')
  }

  if (isProductionLike && !env.TRUST_PROXY) {
    process.stderr.write('[WARN] TRUST_PROXY is not set. Rate limiting may be ineffective behind a load balancer.\n')
  }

  if (isProductionLike && env.API_CORS_ORIGIN === '*') {
    throw new Error('API_CORS_ORIGIN must not be wildcard (*) in production or staging.')
  }

  if (env.API_CORS_ORIGIN.length === 0) {
    throw new Error('API_CORS_ORIGIN must not be empty.')
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

let _cachedApiEnv: ApiEnv | null = null

export const getApiEnv = (): ApiEnv => {
  if (_cachedApiEnv) {
    return _cachedApiEnv
  }

  _cachedApiEnv = assertApiEnvInvariants(decodeApiEnv(process.env))
  return _cachedApiEnv
}

export const resetApiEnvCache = (): void => {
  _cachedApiEnv = null
}

// Redis backs the auth rate limiter so caps hold across process restarts
// and any horizontal scale. In production/staging the URL must be
// configured explicitly; locally we fall back to the dev container.
const resolveConfiguredRedisUrl = (): string | null => {
  const env = getApiEnv()
  if (env.REDIS_URL && env.REDIS_URL.trim().length > 0) {
    return env.REDIS_URL
  }
  if (env.NODE_ENV !== 'production' && env.NODE_ENV !== 'staging') {
    return `redis://127.0.0.1:${process.env.REDIS_PORT ?? '6379'}`
  }
  return null
}

export const getAuthRateLimitRedisUrl = (): string | null =>
  resolveConfiguredRedisUrl()

/**
 * Auth rate limiting is disabled entirely in local development so iterating on
 * sign-in/sign-up pages never locks you out (the limiter is Redis-backed and
 * would otherwise persist across dev-server restarts). Staging/production keep
 * the tight per-path policy.
 */
export const isAuthRateLimitingEnabled = (): boolean =>
  getApiEnv().NODE_ENV !== 'development'

/**
 * Resolves the effective rate-limit policy for a given auth path.
 *
 * Precedence (highest first):
 *   1. explicit `AUTH_RATE_LIMIT_*` env override (when set)
 *   2. the per-path contract policy ({@link getDefaultAuthRateLimitPolicy})
 *   3. the contract default
 *
 * Env overrides are global (one value across all paths). This is what
 * lets the integration harness disable limits suite-wide by setting
 * `AUTH_RATE_LIMIT_MAX_REQUESTS` to a very large number, while real
 * deployments, which set nothing, get the tight per-path defaults.
 */
export const getAuthRateLimitPolicy = (path: AuthRateLimitedPath): AuthRateLimitPolicy => {
  const env = getApiEnv()
  const base = getDefaultAuthRateLimitPolicy(path)

  const windowMsOverride = parseOptionalPositiveInt(env.AUTH_RATE_LIMIT_WINDOW_MS)
  const maxIpOverride = parseOptionalPositiveInt(env.AUTH_RATE_LIMIT_MAX_REQUESTS)
  const maxIdentifierOverride = parseOptionalPositiveInt(env.AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS)

  return {
    windowSeconds:
      windowMsOverride !== undefined
        ? Math.max(1, Math.ceil(windowMsOverride / 1000))
        : base.windowSeconds,
    maxPerIp: maxIpOverride ?? base.maxPerIp,
    // Mirror legacy behaviour: an explicit IP override with no identifier
    // override applies to both buckets.
    maxPerIdentifier: maxIdentifierOverride ?? maxIpOverride ?? base.maxPerIdentifier,
    blockSeconds: base.blockSeconds
  }
}

/**
 * Optional shared secret that lets a TRUSTED caller (the deploy smoke test)
 * bypass auth rate limiting via the `x-auth-rate-limit-bypass` header. Returns
 * null when unset/blank, so the bypass is impossible unless explicitly
 * configured — dev and unconfigured environments can never bypass.
 */
export const getAuthRateLimitBypassToken = (): string | null => {
  const token = getApiEnv().AUTH_RATE_LIMIT_BYPASS_TOKEN?.trim()
  return token && token.length > 0 ? token : null
}

export interface TurnstileConfig {
  readonly secretKey: string
  readonly verifyUrl: string
}

// Cloudflare Turnstile siteverify endpoint (overridable for tests).
const TURNSTILE_DEFAULT_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Returns Turnstile config when a secret is configured, else null.
 *
 * Enforcement is purely presence-gated: with no `TURNSTILE_SECRET_KEY`
 * the sign-up handler skips the check entirely. The integration harness
 * relies on this — it spawns the API with `TURNSTILE_SECRET_KEY=''` so
 * the factory-driven sign-up suite never needs a captcha token.
 */
export const getTurnstileConfig = (): TurnstileConfig | null => {
  const env = getApiEnv()
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim()
  if (!secretKey) {
    return null
  }

  const verifyUrl = env.TURNSTILE_VERIFY_URL?.trim()
  return {
    secretKey,
    verifyUrl: verifyUrl && verifyUrl.length > 0 ? verifyUrl : TURNSTILE_DEFAULT_VERIFY_URL
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

export const getTrustProxy = (): boolean => {
  const env = getApiEnv()
  const rawValue = env.TRUST_PROXY

  if (rawValue === undefined) {
    return false
  }

  const normalized = rawValue.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
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

export interface AuthRefreshCookieConfig {
  name: string
  options: {
    httpOnly: true
    maxAge: number
    path: '/'
    sameSite: 'lax'
    secure: boolean
  }
}

export const getAuthRefreshCookieConfig = (): AuthRefreshCookieConfig => {
  const env = getApiEnv()
  const isProductionLike = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging'

  return {
    name: authRefreshCookieName,
    options: {
      httpOnly: true,
      maxAge: authRefreshCookieMaxAgeMs,
      path: '/',
      sameSite: 'lax',
      secure: isProductionLike
    }
  }
}
