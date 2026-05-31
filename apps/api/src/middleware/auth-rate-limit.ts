import { timingSafeEqual } from 'node:crypto'
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { authRateLimitedPaths } from '@tx-agent-kit/contracts'
import { Effect, Option } from 'effect'
import { getAuthRateLimitBypassToken, getAuthRateLimitConfig, getTrustProxy } from '../config/env.js'

const rateLimitedPaths = new Set<string>(authRateLimitedPaths)

// A trusted caller (the deploy smoke test) may bypass the limiter by sending
// this header with the configured secret. Constant-time compared, and only
// honored when AUTH_RATE_LIMIT_BYPASS_TOKEN is set — external traffic can't set
// it without knowing the secret, and unconfigured envs can never bypass.
const BYPASS_HEADER = 'x-auth-rate-limit-bypass'

const constantTimeEquals = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) {
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}

const hasValidRateLimitBypass = (request: HttpServerRequest.HttpServerRequest): boolean => {
  const expected = getAuthRateLimitBypassToken()
  if (expected === null) {
    return false
  }
  const provided = request.headers[BYPASS_HEADER]
  if (typeof provided !== 'string' || provided.length === 0) {
    return false
  }
  return constantTimeEquals(provided, expected)
}

const MAX_BUCKETS = 50_000

const ipAttemptsByBucket = new Map<string, number[]>()
const identifierAttemptsByBucket = new Map<string, number[]>()

const parsePathname = (rawUrl: string): string => {
  try {
    return new URL(rawUrl, 'http://localhost').pathname
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl
  }
}

const filterToWindow = (attempts: readonly number[], windowMs: number, nowMs: number): number[] =>
  attempts.filter((attemptedAtMs) => nowMs - attemptedAtMs < windowMs)

const pruneStaleBuckets = (buckets: Map<string, number[]>, windowMs: number, nowMs: number): void => {
  for (const [bucket, attempts] of buckets.entries()) {
    const recent = filterToWindow(attempts, windowMs, nowMs)
    if (recent.length === 0) {
      buckets.delete(bucket)
      continue
    }

    buckets.set(bucket, recent)
  }
}

const consumeRateLimitBucket = (
  buckets: Map<string, number[]>,
  bucketKey: string,
  windowMs: number,
  maxRequests: number,
  nowMs: number
): { limited: boolean } => {
  if (buckets.size >= MAX_BUCKETS && !buckets.has(bucketKey)) {
    return { limited: true }
  }

  const currentAttempts = buckets.get(bucketKey) ?? []
  const recentAttempts = filterToWindow(currentAttempts, windowMs, nowMs)

  if (recentAttempts.length >= maxRequests) {
    buckets.set(bucketKey, recentAttempts)
    return { limited: true }
  }

  recentAttempts.push(nowMs)
  buckets.set(bucketKey, recentAttempts)

  return { limited: false }
}

export const toClientIpAddress = (request: HttpServerRequest.HttpServerRequest): string => {
  if (getTrustProxy()) {
    const forwarded = request.headers['x-forwarded-for']
    if (forwarded) {
      const ips = forwarded.split(',').map((s) => s.trim()).filter(Boolean)
      const clientIp = ips[0]
      if (clientIp) {
        return clientIp
      }
    }
  }

  if (Option.isSome(request.remoteAddress) && request.remoteAddress.value.length > 0) {
    return request.remoteAddress.value
  }

  return 'unknown-client'
}

const normalizeIdentifier = (identifier: string): string => identifier.trim().toLowerCase()

export const consumeAuthIdentifierRateLimit = (
  path: string,
  identifier: string
): { limited: boolean; retryAfterSeconds: number } => {
  const config = getAuthRateLimitConfig()
  const normalizedIdentifier = normalizeIdentifier(identifier)
  const nowMs = Date.now()

  pruneStaleBuckets(identifierAttemptsByBucket, config.windowMs, nowMs)

  const decision = consumeRateLimitBucket(
    identifierAttemptsByBucket,
    `${path}:${normalizedIdentifier}`,
    config.windowMs,
    config.maxIdentifierRequests,
    nowMs
  )

  return {
    limited: decision.limited,
    retryAfterSeconds: Math.ceil(config.windowMs / 1000)
  }
}

export const authRateLimitMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const path = parsePathname(request.url)

    if (!rateLimitedPaths.has(path)) {
      return yield* httpApp
    }

    // Trusted bypass (deploy smoke test) — skip the limiter so repeated deploys
    // from one egress IP don't exhaust the per-IP sign-up budget.
    if (hasValidRateLimitBypass(request)) {
      return yield* httpApp
    }

    const config = getAuthRateLimitConfig()
    const nowMs = Date.now()

    pruneStaleBuckets(ipAttemptsByBucket, config.windowMs, nowMs)

    const bucketKey = `${path}:${toClientIpAddress(request)}`
    const decision = consumeRateLimitBucket(
      ipAttemptsByBucket,
      bucketKey,
      config.windowMs,
      config.maxIpRequests,
      nowMs
    )

    if (decision.limited) {
      return yield* HttpServerResponse.json(
        {
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many authentication attempts. Please try again later.'
          }
        },
        {
          status: 429,
          headers: {
            'retry-after': String(Math.ceil(config.windowMs / 1000))
          }
        }
      ).pipe(Effect.orDie)
    }

    return yield* httpApp
  })
)
