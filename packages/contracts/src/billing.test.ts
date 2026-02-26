import { describe, expect, it } from 'vitest'
import {
  DECIMILLICENTS_PER_CENT,
  DECIMILLICENTS_PER_DOLLAR,
  fromDecimillicents,
  toDecimillicents
} from './billing.js'

describe('billing money helpers', () => {
  it('defines the expected decimillicent constants', () => {
    expect(DECIMILLICENTS_PER_CENT).toBe(100_000)
    expect(DECIMILLICENTS_PER_DOLLAR).toBe(10_000_000)
  })

  it('converts dollars to decimillicents', () => {
    expect(toDecimillicents(1)).toBe(10_000_000)
    expect(toDecimillicents(0.0001)).toBe(1_000)
  })

  it('converts decimillicents back to dollars', () => {
    expect(fromDecimillicents(10_000_000)).toBe(1)
    expect(fromDecimillicents(1_000)).toBe(0.0001)
  })
})
