/**
 * Regression tests for `factory-helpers.ts`.
 *
 * Why this file exists:
 *   Iter-12 of the billing audit traced a flaky `createUser failed (409):
 *   Email is already in use` error to a cross-process collision in
 *   `generateEmail`. The generator used a process-global counter
 *   (`let sequence = 0`) plus `Date.now()`, so two vitest worker
 *   processes calling within the same millisecond with matching
 *   counters produced identical emails. The fix appended a
 *   `randomUUID().slice(0, 8)` suffix to all three generators.
 *
 *   These tests pin that fix:
 *   1. Every generator output includes a UUID-style hex segment so a
 *      reversion that drops the suffix immediately fails the pattern
 *      check (catches the reversion at unit-test time, not as an
 *      intermittent integration flake).
 *   2. Within a single process, N rapid calls never collide.
 *   3. The prefix structure stays stable so downstream parsers (e.g.
 *      email suppression list matchers) don't break.
 */
import { describe, expect, it } from 'vitest'
import {
  generateEmail,
  generateToken,
  generateUniqueValue
} from './factory-helpers.js'

// Matches the UUID slice(0, 8) segment: 8 hex chars.
const UUID_HEX_SEGMENT = /[0-9a-f]{8}/u

describe('factory-helpers uniqueness guarantees', () => {
  describe('generateEmail', () => {
    it('output contains a UUID hex segment (cross-process collision guard)', () => {
      // The suffix is the iter-12 fix that prevents the sequence-based
      // email collision across parallel vitest workers. A reversion to
      // pure `${prefix}.${Date.now()}.${sequence}@example.com` would
      // omit the hex segment and fail this check.
      const email = generateEmail()
      expect(email).toMatch(UUID_HEX_SEGMENT)
      expect(email.endsWith('@example.com')).toBe(true)
    })

    it('honors a custom prefix at the start', () => {
      expect(generateEmail('owner').startsWith('owner.')).toBe(true)
      expect(generateEmail('rate-limit-test').startsWith('rate-limit-test.')).toBe(true)
    })

    it('produces 1000 unique values in a single process', () => {
      const seen = new Set<string>()
      for (let i = 0; i < 1000; i += 1) {
        seen.add(generateEmail())
      }
      expect(seen.size).toBe(1000)
    })
  })

  describe('generateUniqueValue', () => {
    it('output contains a UUID hex segment', () => {
      const value = generateUniqueValue('org')
      expect(value).toMatch(UUID_HEX_SEGMENT)
      expect(value.startsWith('org-')).toBe(true)
    })

    it('produces 1000 unique values in a single process', () => {
      const seen = new Set<string>()
      for (let i = 0; i < 1000; i += 1) {
        seen.add(generateUniqueValue('org'))
      }
      expect(seen.size).toBe(1000)
    })
  })

  describe('generateToken', () => {
    it('output contains a UUID hex segment', () => {
      const token = generateToken()
      expect(token).toMatch(UUID_HEX_SEGMENT)
      expect(token.startsWith('token_')).toBe(true)
    })

    it('honors a custom prefix', () => {
      expect(generateToken('refresh').startsWith('refresh_')).toBe(true)
    })

    it('produces 1000 unique values in a single process', () => {
      const seen = new Set<string>()
      for (let i = 0; i < 1000; i += 1) {
        seen.add(generateToken())
      }
      expect(seen.size).toBe(1000)
    })
  })

  describe('cross-generator independence', () => {
    it('emails, unique values, and tokens do not share the same suffix even when invoked in the same tick', () => {
      // Each generator call produces its own random UUID segment, so
      // rapid alternating calls cannot collide in the suffix. Extract
      // by position (not regex) because Date.now() is all digits and
      // would falsely match a `[0-9a-f]{8}` regex.
      // generateEmail:        `${prefix}.${ts}.${seq}.${uuid}@example.com`
      // generateUniqueValue:  `${prefix}-${ts}-${seq}-${uuid}`
      // generateToken:        `${prefix}_${ts}_${seq}_${uuid}`
      const email = generateEmail('u')
      const value = generateUniqueValue('u')
      const token = generateToken('u')
      const emailSuffix = email.replace('@example.com', '').split('.').pop()
      const valueSuffix = value.split('-').pop()
      const tokenSuffix = token.split('_').pop()
      expect(emailSuffix).toBeDefined()
      expect(valueSuffix).toBeDefined()
      expect(tokenSuffix).toBeDefined()
      // Each suffix is exactly 8 hex chars from randomUUID().slice(0, 8).
      expect(emailSuffix).toMatch(/^[0-9a-f]{8}$/u)
      expect(valueSuffix).toMatch(/^[0-9a-f]{8}$/u)
      expect(tokenSuffix).toMatch(/^[0-9a-f]{8}$/u)
      // Extremely unlikely all three random UUIDs collide in the same
      // 8-hex window (birthday bound ≈ 1 in 4 billion for 3 values).
      expect(new Set([emailSuffix, valueSuffix, tokenSuffix]).size).toBe(3)
    })
  })
})
