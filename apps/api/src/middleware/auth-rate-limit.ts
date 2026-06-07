import { timingSafeEqual } from 'node:crypto'
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { authRateLimitedPaths, type AuthRateLimitedPath, type AuthRateLimitPolicy } from '@tx-agent-kit/contracts'
import { recordAuthRateLimitRejected } from '@tx-agent-kit/observability'
import { createRedisQuotaLimiter, getOrCreateRedisClient, type RedisQuotaLimiter } from '@tx-agent-kit/redis'
import { Effect, Option } from 'effect'
import {
  getAuthRateLimitBypassToken,
  getAuthRateLimitPolicy,
  getAuthRateLimitRedisUrl,
  getTrustProxy,
  isAuthRateLimitingEnabled
} from '../config/env.js'

// Membership check kept as a Set<string> so a raw request path is matched
// without any cast; the typed path is recovered via findAuthRateLimitedPath.
const rateLimitedPaths = new Set<string>(authRateLimitedPaths)

// A trusted caller (the deploy smoke test) may bypass the limiter by sending
// this header with the configured secret. Constant-time compared, and only
// honored when AUTH_RATE_LIMIT_BYPASS_TOKEN is set. External traffic can't set
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

export const hasValidRateLimitBypass = (request: HttpServerRequest.HttpServerRequest): boolean => {
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

// Each limited path has two independent buckets: one keyed by client IP,
// one by normalized identifier (email). `perIdentifier` selects between
// them without an inline string-union enum.
interface BucketKind {
  readonly perIdentifier: boolean
  readonly tag: string
}

const IP_BUCKET: BucketKind = { perIdentifier: false, tag: 'ip' }
const IDENTIFIER_BUCKET: BucketKind = { perIdentifier: true, tag: 'id' }

const MAX_BUCKETS = 50_000

// In-memory sliding-window buckets. These are the FALLBACK used when
// Redis is unreachable: a Redis outage degrades to process-local
// protection rather than removing the limit or locking users out.
const ipAttemptsByBucket = new Map<string, number[]>()
const identifierAttemptsByBucket = new Map<string, number[]>()

const parsePathname = (rawUrl: string): string => {
  try {
    return new URL(rawUrl, 'http://localhost').pathname
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl
  }
}

// Returns the literal-typed path when it is rate-limited, else null.
// The Set check is the membership gate; the tuple scan recovers the
// literal type for the policy lookup without a cast.
const findAuthRateLimitedPath = (path: string): AuthRateLimitedPath | null => {
  if (!rateLimitedPaths.has(path)) {
    return null
  }
  for (const candidate of authRateLimitedPaths) {
    if (candidate === path) {
      return candidate
    }
  }
  return null
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

const pointsForKind = (policy: AuthRateLimitPolicy, kind: BucketKind): number =>
  kind.perIdentifier ? policy.maxPerIdentifier : policy.maxPerIp

// ── Redis-backed limiters (primary) ──────────────────────────────────
//
// One limiter per (path, kind), cached and rebuilt only when the
// resolved Redis URL or policy numbers change (which in practice only
// happens in tests that mutate the env). The shared Redis store means
// limits hold across process restarts and any future horizontal scale.

// Cached by a key that encodes the full resolved config, so a config
// change (only happens in tests that mutate env) yields a fresh limiter
// rather than reusing a stale one, and the cached value is just the
// limiter, no guard needed on read.
const redisLimiters = new Map<string, RedisQuotaLimiter>()

const getRedisLimiter = (
  path: AuthRateLimitedPath,
  kind: BucketKind,
  policy: AuthRateLimitPolicy
): RedisQuotaLimiter | null => {
  const redisUrl = getAuthRateLimitRedisUrl()
  if (redisUrl === null) {
    return null
  }

  const points = pointsForKind(policy, kind)
  const cacheKey = `${redisUrl}|${kind.tag}|${path}|${policy.windowSeconds}|${points}|${policy.blockSeconds}`
  const existing = redisLimiters.get(cacheKey)
  if (existing) {
    return existing
  }

  const limiter = createRedisQuotaLimiter({
    client: getOrCreateRedisClient({ url: redisUrl }),
    keyPrefix: `arl:${kind.tag}:${path}`,
    points,
    durationSeconds: policy.windowSeconds,
    blockDurationSeconds: policy.blockSeconds
  })
  redisLimiters.set(cacheKey, limiter)
  return limiter
}

export interface AuthRateLimitDecision {
  readonly limited: boolean
  readonly retryAfterSeconds: number
}

const consumeInMemory = (
  path: AuthRateLimitedPath,
  kind: BucketKind,
  bucketValue: string,
  policy: AuthRateLimitPolicy
): AuthRateLimitDecision => {
  const windowMs = policy.windowSeconds * 1000
  const buckets = kind.perIdentifier ? identifierAttemptsByBucket : ipAttemptsByBucket
  const nowMs = Date.now()

  pruneStaleBuckets(buckets, windowMs, nowMs)

  const decision = consumeRateLimitBucket(
    buckets,
    `${path}:${bucketValue}`,
    windowMs,
    pointsForKind(policy, kind),
    nowMs
  )

  return { limited: decision.limited, retryAfterSeconds: Math.ceil(windowMs / 1000) }
}

const consumeRateLimit = async (
  path: AuthRateLimitedPath,
  kind: BucketKind,
  bucketValue: string
): Promise<AuthRateLimitDecision> => {
  // Disabled in local development: never limit, never touch Redis.
  if (!isAuthRateLimitingEnabled()) {
    return { limited: false, retryAfterSeconds: 0 }
  }

  const policy = getAuthRateLimitPolicy(path)
  const limiter = getRedisLimiter(path, kind, policy)

  if (limiter !== null) {
    try {
      const decision = await limiter.consume(bucketValue)
      return { limited: !decision.allowed, retryAfterSeconds: decision.retryAfterSeconds }
    } catch {
      // Redis unreachable mid-flight: fall through to the in-memory
      // limiter so an outage degrades gracefully instead of either
      // removing protection or hard-failing every auth request.
    }
  }

  return consumeInMemory(path, kind, bucketValue, policy)
}

export const consumeAuthIpRateLimit = (
  path: AuthRateLimitedPath,
  ipAddress: string
): Promise<AuthRateLimitDecision> => consumeRateLimit(path, IP_BUCKET, ipAddress)

export const consumeAuthIdentifierRateLimit = (
  path: AuthRateLimitedPath,
  identifier: string
): Promise<AuthRateLimitDecision> =>
  consumeRateLimit(path, IDENTIFIER_BUCKET, normalizeIdentifier(identifier))

export const authRateLimitMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const path = findAuthRateLimitedPath(parsePathname(request.url))

    if (path === null) {
      return yield* httpApp
    }

    // Trusted bypass (deploy smoke test): skip the limiter so repeated deploys
    // from one egress IP don't exhaust the per-IP sign-up budget.
    if (hasValidRateLimitBypass(request)) {
      return yield* httpApp
    }

    // tryPromise (not promise): a limiter rejection must be a logged, typed
    // error rather than a silent Effect defect. Fail OPEN on unexpected failure
    // so a limiter hiccup never locks legitimate auth traffic out.
    const decision = yield* Effect.tryPromise({
      try: () => consumeAuthIpRateLimit(path, toClientIpAddress(request)),
      catch: (cause) => cause
    }).pipe(
      Effect.catchAll((cause) =>
        Effect.logError('Auth IP rate-limit check failed; failing open', { path, cause }).pipe(
          Effect.as({ limited: false as const })
        )
      )
    )

    if (decision.limited) {
      // `path` is the bounded, literal-typed limited path (low-cardinality),
      // emitted once per rejected request, never on allowed requests.
      yield* Effect.sync(() => recordAuthRateLimitRejected(path))
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
            'retry-after': String(decision.retryAfterSeconds)
          }
        }
      ).pipe(Effect.orDie)
    }

    return yield* httpApp
  })
)

/**
 * Test-only reset. Clears the in-memory fallback buckets and the cached
 * Redis limiter handles so a spec can start from a known state.
 */
export const __resetAuthRateLimitForTest = (): void => {
  ipAttemptsByBucket.clear()
  identifierAttemptsByBucket.clear()
  redisLimiters.clear()
}
