import { describe, expect, it } from 'vitest'
import { isValidTeamName, normalizeTeamName } from './team-domain.js'

describe('normalizeTeamName', () => {
  it('trims whitespace', () => {
    expect(normalizeTeamName('  Marketing  ')).toBe('Marketing')
  })

  it('preserves inner whitespace', () => {
    expect(normalizeTeamName('  My Team  ')).toBe('My Team')
  })
})

describe('isValidTeamName', () => {
  it('accepts names between 2 and 64 characters', () => {
    expect(isValidTeamName('AB')).toBe(true)
    expect(isValidTeamName('A'.repeat(64))).toBe(true)
  })

  it('rejects single-character names', () => {
    expect(isValidTeamName('A')).toBe(false)
  })

  it('rejects empty names', () => {
    expect(isValidTeamName('')).toBe(false)
    expect(isValidTeamName('   ')).toBe(false)
  })

  it('rejects names longer than 64 characters', () => {
    expect(isValidTeamName('A'.repeat(65))).toBe(false)
  })

  it('trims before checking length', () => {
    expect(isValidTeamName('  AB  ')).toBe(true)
    expect(isValidTeamName('  A  ')).toBe(false)
  })
})
