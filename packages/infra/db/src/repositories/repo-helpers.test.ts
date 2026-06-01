import { describe, expect, it } from 'vitest'
import { Effect, Exit } from 'effect'
import { isTransientPostgresError } from '../errors.js'
import { retryTransientDbErrors } from './repo-helpers.js'

// A pg-driver-shaped error (the `code` field is what extractPostgresError reads).
const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code })

describe('isTransientPostgresError', () => {
  it('is true for rollback-guaranteed transient codes', () => {
    expect(isTransientPostgresError(pgError('40001'))).toBe(true) // serialization_failure
    expect(isTransientPostgresError(pgError('40P01'))).toBe(true) // deadlock_detected
  })

  it('is true when the transient code is nested in the cause chain', () => {
    expect(isTransientPostgresError(new Error('wrapper', { cause: pgError('40001') }))).toBe(true)
  })

  it('is false for non-transient / client errors (no blind retry)', () => {
    expect(isTransientPostgresError(pgError('23505'))).toBe(false) // unique_violation
    expect(isTransientPostgresError(pgError('22P02'))).toBe(false) // invalid_text_representation
    expect(isTransientPostgresError(pgError('08006'))).toBe(false) // connection failure — ambiguous commit, NOT retried
    expect(isTransientPostgresError(new Error('plain'))).toBe(false)
    expect(isTransientPostgresError(undefined)).toBe(false)
  })
})

describe('retryTransientDbErrors', () => {
  it('retries a transient error then succeeds', async () => {
    let attempts = 0
    const effect = Effect.suspend(() => {
      attempts += 1
      return attempts < 3 ? Effect.fail(pgError('40001')) : Effect.succeed('ok')
    })

    const result = await Effect.runPromise(retryTransientDbErrors(effect))
    expect(result).toBe('ok')
    expect(attempts).toBe(3) // failed twice, succeeded on the third
  })

  it('gives up after the bounded retry budget on a persistent transient error', async () => {
    let attempts = 0
    const effect = Effect.suspend(() => {
      attempts += 1
      return Effect.fail(pgError('40P01'))
    })

    const exit = await Effect.runPromiseExit(retryTransientDbErrors(effect))
    expect(Exit.isFailure(exit)).toBe(true)
    // default budget = 3 retries → 4 total attempts
    expect(attempts).toBe(4)
  })

  it('does NOT retry a non-transient error (fails on the first attempt)', async () => {
    let attempts = 0
    const effect = Effect.suspend(() => {
      attempts += 1
      return Effect.fail(pgError('23505')) // unique violation — a client conflict, never retried
    })

    const exit = await Effect.runPromiseExit(retryTransientDbErrors(effect))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(attempts).toBe(1)
  })
})
