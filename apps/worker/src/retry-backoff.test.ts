import { describe, expect, it, vi } from 'vitest'

// Asymmetric matchers are typed `any`; nested in object literals they trip
// no-unsafe-assignment, so nest them through this `unknown`-typed wrapper.
const stringContaining = (text: string): unknown => expect.stringContaining(text)
import {
  computeBackoffDelayMs,
  reconcileUntilComplete,
  ReconciliationIncompleteError,
  retryWithBackoff,
  RetryAbortedError,
  sleepWithSignal,
  type BackoffPolicy
} from './retry-backoff.js'

const policy: BackoffPolicy = {
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitterRatio: 0.2
}

/** A fake clock whose sleep advances time instead of waiting. */
const fakeClock = (start = 0) => {
  let nowMs = start
  const sleeps: number[] = []
  return {
    now: () => nowMs,
    sleep: (ms: number) => {
      sleeps.push(ms)
      nowMs += ms
      return Promise.resolve()
    },
    advance: (ms: number) => {
      nowMs += ms
    },
    sleeps
  }
}

const fakeLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
})

const deadlineExceeded = () => new Error('4 DEADLINE_EXCEEDED: Deadline exceeded')

describe('computeBackoffDelayMs', () => {
  it('grows exponentially from the initial delay and never exceeds the cap', () => {
    const noJitter = { ...policy, jitterRatio: 0 }
    expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => computeBackoffDelayMs(noJitter, attempt)))
      .toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000])
  })

  it('stays capped and finite for very large attempt counts', () => {
    for (const attempt of [50, 1000, 100_000, Number.MAX_SAFE_INTEGER]) {
      const delay = computeBackoffDelayMs(policy, attempt, () => 0)
      expect(delay).toBe(30_000)
    }
  })

  it('keeps every jittered delay within [(1 - jitterRatio) * base, base]', () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (attempt - 1))
      for (const random of [0, 0.25, 0.5, 0.999_999]) {
        const delay = computeBackoffDelayMs(policy, attempt, () => random)
        expect(delay).toBeGreaterThanOrEqual(Math.floor(base * (1 - policy.jitterRatio)))
        expect(delay).toBeLessThanOrEqual(base)
      }
    }
  })

  it('treats attempts below 1 as the first attempt', () => {
    expect(computeBackoffDelayMs({ ...policy, jitterRatio: 0 }, 0)).toBe(1000)
    expect(computeBackoffDelayMs({ ...policy, jitterRatio: 0 }, -3)).toBe(1000)
  })
})

describe('sleepWithSignal', () => {
  it('rejects immediately with RetryAbortedError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sleepWithSignal(60_000, controller.signal)).rejects.toBeInstanceOf(RetryAbortedError)
  })

  it('rejects promptly when the signal aborts mid-sleep', async () => {
    const controller = new AbortController()
    const sleeping = sleepWithSignal(60_000, controller.signal)
    controller.abort()
    await expect(sleeping).rejects.toBeInstanceOf(RetryAbortedError)
  })

  it('resolves after the delay when not aborted', async () => {
    await expect(sleepWithSignal(1)).resolves.toBeUndefined()
  })
})

describe('retryWithBackoff', () => {
  it('returns the first successful result without logging when nothing fails', async () => {
    const clock = fakeClock()
    const logger = fakeLogger()
    const operation = vi.fn(() => Promise.resolve('ok'))

    await expect(retryWithBackoff(operation, {
      label: 'connect to Temporal',
      policy,
      escalateAfterMs: 60_000,
      logger,
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0
    })).resolves.toBe('ok')

    expect(operation).toHaveBeenCalledTimes(1)
    expect(clock.sleeps).toEqual([])
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('retries transient failures with capped backoff, warning on each, then logs recovery', async () => {
    const clock = fakeClock()
    const logger = fakeLogger()
    const operation = vi.fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(deadlineExceeded())
      .mockRejectedValueOnce(deadlineExceeded())
      .mockRejectedValueOnce(deadlineExceeded())
      .mockResolvedValue('connected')

    await expect(retryWithBackoff(operation, {
      label: 'connect to Temporal',
      policy: { ...policy, jitterRatio: 0 },
      escalateAfterMs: 60_000,
      logger,
      now: clock.now,
      sleep: clock.sleep
    })).resolves.toBe('connected')

    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3, 4])
    expect(clock.sleeps).toEqual([1000, 2000, 4000])
    expect(logger.warn).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledWith(
      'connect to Temporal failed; retrying with backoff.',
      expect.objectContaining({ attempt: 1, nextDelayMs: 1000, error: stringContaining('DEADLINE_EXCEEDED') })
    )
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'connect to Temporal succeeded after retrying.',
      expect.objectContaining({ attempts: 4 })
    )
  })

  it('escalates to error logging (and calls onEscalate exactly once) only after failing for escalateAfterMs', async () => {
    const clock = fakeClock()
    const logger = fakeLogger()
    const onEscalate = vi.fn()
    let calls = 0
    const operation = () => {
      calls += 1
      return calls <= 8 ? Promise.reject(deadlineExceeded()) : Promise.resolve('done')
    }

    await retryWithBackoff(operation, {
      label: 'reconcile schedules',
      policy: { ...policy, jitterRatio: 0 },
      escalateAfterMs: 20_000,
      logger,
      onEscalate,
      now: clock.now,
      sleep: clock.sleep
    })

    // Failures at elapsed 0, 1s, 3s, 7s, 15s warn; 31s, 61s, 91s error.
    expect(logger.warn).toHaveBeenCalledTimes(5)
    expect(logger.error).toHaveBeenCalledTimes(3)
    expect(logger.error).toHaveBeenCalledWith(
      'reconcile schedules is still failing after retrying; retrying with backoff.',
      expect.objectContaining({ attempt: 6 })
    )
    expect(onEscalate).toHaveBeenCalledTimes(1)
    expect(onEscalate).toHaveBeenCalledWith(expect.objectContaining({ message: stringContaining('DEADLINE_EXCEEDED') }))
  })

  it('gives up with the last error once the next wait would pass maxElapsedMs', async () => {
    const clock = fakeClock()
    const logger = fakeLogger()
    let calls = 0
    const operation = () => {
      calls += 1
      return Promise.reject(new Error(`unavailable #${calls}`))
    }

    await expect(retryWithBackoff(operation, {
      label: 'connect to Temporal',
      policy: { ...policy, jitterRatio: 0 },
      escalateAfterMs: 5000,
      maxElapsedMs: 10_000,
      logger,
      now: clock.now,
      sleep: clock.sleep
    })).rejects.toThrow('unavailable #4')

    // Waits 1s, 2s, 4s (elapsed 7s); the next 8s wait would pass 10s, so it stops.
    expect(clock.sleeps).toEqual([1000, 2000, 4000])
    expect(logger.error).toHaveBeenCalledWith(
      'connect to Temporal is still failing; giving up.',
      expect.objectContaining({ attempt: 4, error: stringContaining('unavailable #4') })
    )
  })

  it('shares one budget across calls when given startedAtMs', async () => {
    const clock = fakeClock(100_000)
    const logger = fakeLogger()

    await expect(retryWithBackoff(() => Promise.reject(new Error('still down')), {
      label: 'create worker',
      policy: { ...policy, jitterRatio: 0 },
      escalateAfterMs: 1,
      maxElapsedMs: 10_000,
      startedAtMs: 100_000 - 9500,
      logger,
      now: clock.now,
      sleep: clock.sleep
    })).rejects.toThrow('still down')

    expect(clock.sleeps).toEqual([])
  })

  it('does not retry errors the caller marks as permanent', async () => {
    const clock = fakeClock()
    const logger = fakeLogger()
    const operation = vi.fn(() => Promise.reject(new TypeError('bad TLS config')))

    await expect(retryWithBackoff(operation, {
      label: 'connect to Temporal',
      policy,
      escalateAfterMs: 5000,
      isRetryable: (error) => !(error instanceof TypeError),
      logger,
      now: clock.now,
      sleep: clock.sleep
    })).rejects.toThrow('bad TLS config')

    expect(operation).toHaveBeenCalledTimes(1)
    expect(clock.sleeps).toEqual([])
  })

  it('stops with RetryAbortedError when the signal aborts, without another attempt', async () => {
    const controller = new AbortController()
    const logger = fakeLogger()
    const operation = vi.fn(() => {
      controller.abort()
      return Promise.reject(deadlineExceeded())
    })

    await expect(retryWithBackoff(operation, {
      label: 'reconcile schedules',
      policy,
      escalateAfterMs: 5000,
      signal: controller.signal,
      logger
    })).rejects.toBeInstanceOf(RetryAbortedError)

    expect(operation).toHaveBeenCalledTimes(1)
  })
})

describe('reconcileUntilComplete', () => {
  it('runs every step once, in order, when all succeed', async () => {
    const order: string[] = []
    const step = (name: string) => ({
      name,
      run: () => {
        order.push(name)
        return Promise.resolve()
      }
    })

    await reconcileUntilComplete([step('a'), step('b'), step('c')], {
      label: 'schedule reconciliation',
      policy,
      escalateAfterMs: 60_000,
      logger: fakeLogger()
    })

    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('keeps going past a failing step and retries only the steps that failed', async () => {
    const clock = fakeClock()
    const logger = fakeLogger()
    const order: string[] = []
    let lifecycleFailures = 2
    const steps = [
      { name: 'outbox', run: () => { order.push('outbox'); return Promise.resolve() } },
      {
        name: 'lifecycle-email',
        run: () => {
          order.push('lifecycle-email')
          if (lifecycleFailures > 0) {
            lifecycleFailures -= 1
            return Promise.reject(new Error('Failed to describe schedule: 4 DEADLINE_EXCEEDED'))
          }
          return Promise.resolve()
        }
      },
      { name: 'entitlement', run: () => { order.push('entitlement'); return Promise.resolve() } }
    ]

    await reconcileUntilComplete(steps, {
      label: 'schedule reconciliation',
      policy: { ...policy, jitterRatio: 0 },
      escalateAfterMs: 60_000,
      logger,
      now: clock.now,
      sleep: clock.sleep
    })

    expect(order).toEqual(['outbox', 'lifecycle-email', 'entitlement', 'lifecycle-email', 'lifecycle-email'])
    expect(clock.sleeps).toEqual([1000, 2000])
    expect(logger.warn).toHaveBeenCalledWith(
      'schedule reconciliation failed; retrying with backoff.',
      expect.objectContaining({
        attempt: 1,
        failedSteps: ['lifecycle-email'],
        error: stringContaining('DEADLINE_EXCEEDED')
      })
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reports every failed step in ReconciliationIncompleteError', () => {
    const error = new ReconciliationIncompleteError([
      { step: 'a', error: new Error('boom') },
      { step: 'b', error: 'plain' }
    ])
    expect(error.failedSteps).toEqual(['a', 'b'])
    expect(error.message).toContain('a: boom')
    expect(error.message).toContain('b: plain')
  })

  it('stops before the next step once aborted', async () => {
    const controller = new AbortController()
    const ran: string[] = []
    const steps = [
      { name: 'first', run: () => { ran.push('first'); controller.abort(); return Promise.resolve() } },
      { name: 'second', run: () => { ran.push('second'); return Promise.resolve() } }
    ]

    await expect(reconcileUntilComplete(steps, {
      label: 'schedule reconciliation',
      policy,
      escalateAfterMs: 60_000,
      signal: controller.signal,
      logger: fakeLogger()
    })).rejects.toBeInstanceOf(RetryAbortedError)

    expect(ran).toEqual(['first'])
  })
})
