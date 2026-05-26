import { describe, expect, it } from 'vitest'
import {
  createFlexibleQuotaLimiter,
  type FlexibleRateLimiter,
  type FlexibleRateLimiterReply
} from './redis-quota.js'

class FakeFlexibleRateLimiter implements FlexibleRateLimiter {
  private consumed = 0

  constructor(private readonly limit: number) {}

  consume(): Promise<FlexibleRateLimiterReply> {
    this.consumed += 1
    if (this.consumed > this.limit) {
      return Promise.reject(Object.assign(new Error('quota exhausted'), {
        msBeforeNext: 28_000,
        remainingPoints: 0,
        consumedPoints: this.consumed,
        isFirstInDuration: false
      } satisfies FlexibleRateLimiterReply))
    }

    return Promise.resolve({
      msBeforeNext: 30_000,
      remainingPoints: this.limit - this.consumed,
      consumedPoints: this.consumed,
      isFirstInDuration: this.consumed === 1
    })
  }

  delete(): Promise<boolean> {
    this.consumed = 0
    return Promise.resolve(true)
  }
}

describe('createFlexibleQuotaLimiter', () => {
  it('normalizes allowed and exhausted limiter results', async () => {
    const limiter = createFlexibleQuotaLimiter(new FakeFlexibleRateLimiter(2))

    await expect(limiter.consume('tenant-one')).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 30
    })
    await expect(limiter.consume('tenant-one')).resolves.toMatchObject({
      allowed: true,
      remaining: 0
    })
    await expect(limiter.consume('tenant-one')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 28
    })
  })

  it('keeps delete available for test cleanup and admin resets', async () => {
    const limiter = createFlexibleQuotaLimiter(new FakeFlexibleRateLimiter(1))
    await limiter.consume('tenant-two')
    await limiter.delete('tenant-two')

    await expect(limiter.consume('tenant-two')).resolves.toMatchObject({
      allowed: true,
      remaining: 0
    })
  })
})
