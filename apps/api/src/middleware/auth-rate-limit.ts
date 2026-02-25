import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { Effect, Option } from 'effect'
import { getAuthRateLimitConfig } from '../config/env.js'

const rateLimitedPaths = new Set<string>([
  '/v1/auth/sign-in',
  '/v1/auth/forgot-password'
])

const attemptsByBucket = new Map<string, number[]>()

const parsePathname = (rawUrl: string): string => {
  try {
    return new URL(rawUrl, 'http://localhost').pathname
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl
  }
}

const toClientIdentifier = (request: HttpServerRequest.HttpServerRequest): string => {
  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string') {
    const [first] = forwardedFor.split(',')
    const candidate = first?.trim()
    if (candidate) {
      return candidate
    }
  }

  if (Option.isSome(request.remoteAddress) && request.remoteAddress.value.length > 0) {
    return request.remoteAddress.value
  }

  return 'unknown-client'
}

const filterToWindow = (attempts: readonly number[], windowMs: number, nowMs: number): number[] =>
  attempts.filter((attemptedAtMs) => nowMs - attemptedAtMs < windowMs)

const pruneStaleBuckets = (windowMs: number, nowMs: number): void => {
  for (const [bucket, attempts] of attemptsByBucket.entries()) {
    const recent = filterToWindow(attempts, windowMs, nowMs)
    if (recent.length === 0) {
      attemptsByBucket.delete(bucket)
      continue
    }

    attemptsByBucket.set(bucket, recent)
  }
}

export const authRateLimitMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const path = parsePathname(request.url)

    if (!rateLimitedPaths.has(path)) {
      return yield* httpApp
    }

    const config = getAuthRateLimitConfig()
    const nowMs = Date.now()

    if (attemptsByBucket.size > 10_000) {
      pruneStaleBuckets(config.windowMs, nowMs)
    }

    const bucketKey = `${path}:${toClientIdentifier(request)}`
    const currentAttempts = attemptsByBucket.get(bucketKey) ?? []
    const recentAttempts = filterToWindow(currentAttempts, config.windowMs, nowMs)

    if (recentAttempts.length >= config.maxRequests) {
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

    recentAttempts.push(nowMs)
    attemptsByBucket.set(bucketKey, recentAttempts)

    return yield* httpApp
  })
)
