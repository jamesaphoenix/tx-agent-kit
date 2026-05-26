import { RateLimiterRedis } from 'rate-limiter-flexible'
import type { RedisClient } from './redis-client.js'

export interface FlexibleRateLimiterReply {
  readonly msBeforeNext: number
  readonly remainingPoints: number
  readonly consumedPoints: number
  readonly isFirstInDuration: boolean
}

export interface FlexibleRateLimiter {
  readonly consume: (key: string, points?: number) => Promise<FlexibleRateLimiterReply>
  readonly delete: (key: string) => Promise<boolean>
}

export interface RedisQuotaDecision {
  readonly allowed: boolean
  readonly remaining: number
  readonly retryAfterSeconds: number
  readonly resetAtMs: number | null
}

export interface RedisQuotaLimiter {
  readonly consume: (key: string, points?: number) => Promise<RedisQuotaDecision>
  readonly delete: (key: string) => Promise<boolean>
}

export interface RedisQuotaLimiterOptions {
  readonly client: RedisClient
  readonly keyPrefix: string
  readonly points: number
  readonly durationSeconds: number
  readonly blockDurationSeconds?: number
}

const isFlexibleRateLimiterReply = (value: unknown): value is FlexibleRateLimiterReply =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { msBeforeNext?: unknown }).msBeforeNext === 'number' &&
  typeof (value as { remainingPoints?: unknown }).remainingPoints === 'number' &&
  typeof (value as { consumedPoints?: unknown }).consumedPoints === 'number'

const toQuotaDecision = (
  allowed: boolean,
  reply: FlexibleRateLimiterReply
): RedisQuotaDecision => ({
  allowed,
  remaining: Math.max(0, reply.remainingPoints),
  retryAfterSeconds: Math.ceil(Math.max(0, reply.msBeforeNext) / 1000),
  resetAtMs: reply.msBeforeNext > 0 ? Date.now() + reply.msBeforeNext : null
})

export const createFlexibleQuotaLimiter = (
  limiter: FlexibleRateLimiter
): RedisQuotaLimiter => ({
  consume: async (key, points = 1) => {
    try {
      return toQuotaDecision(true, await limiter.consume(key, points))
    } catch (error: unknown) {
      if (isFlexibleRateLimiterReply(error)) {
        return toQuotaDecision(false, error)
      }
      throw error
    }
  },
  delete: (key) => limiter.delete(key)
})

export const createRedisQuotaLimiter = (
  options: RedisQuotaLimiterOptions
): RedisQuotaLimiter =>
  createFlexibleQuotaLimiter(new RateLimiterRedis({
    storeClient: options.client,
    keyPrefix: options.keyPrefix,
    points: options.points,
    duration: options.durationSeconds,
    blockDuration: options.blockDurationSeconds ?? 0
  }))
