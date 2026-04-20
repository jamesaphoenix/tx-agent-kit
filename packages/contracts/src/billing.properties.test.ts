import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  aggregateCosts,
  createCostResult,
  DEFAULT_MARGIN_MULTIPLIER
} from './billing.js'

/**
 * Property-based tests for the margin math helpers.
 *
 * Example tests in `billing.test.ts` cover specific inputs but not
 * the whole space. These assert invariants that MUST hold for every
 * valid input:
 *
 *   1. Monotonicity of `createCostResult` — more cost in means more
 *      (or equal) margin cost out.
 *   2. Non-undercharging — the margin cost is always >= the base
 *      cost for margin >= 1.
 *   3. Integer-only outputs — never a fractional ledger row.
 *   4. Ceiling-on-boundaries — integer basis points produce a ceil-
 *      rounded margin, so the debit is never short.
 *   5. `aggregateCosts` commutativity — summing the same set in any
 *      order produces the same totals.
 *   6. `aggregateCosts` zero — an empty array produces zero totals.
 *   7. `aggregateCosts` linearity — total is the sum of parts.
 *
 * Runs 200 cases per property by default; bump via `numRuns` for
 * extra coverage.
 *
 * @spec INV-BILLING-006 — fixed-margin pricing via integer basis points.
 */

const safeCost = () =>
  fc.integer({ min: 0, max: 10_000_000_000 }) // up to $1000

const safeMargin = () =>
  fc.double({ min: 1, max: 5, noNaN: true, noDefaultInfinity: true })

describe('createCostResult properties', () => {
  it('monotonic in the base cost (for a fixed margin)', () => {
    fc.assert(
      fc.property(safeCost(), safeCost(), (a, b) => {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        const resLo = createCostResult('ai.test.op', lo)
        const resHi = createCostResult('ai.test.op', hi)
        return (
          resHi.marginCostInCreditsDecimillicents
            >= resLo.marginCostInCreditsDecimillicents
        )
      }),
      { numRuns: 200 }
    )
  })

  it('never undercharges (marginCost >= base cost for margin >= 1)', () => {
    fc.assert(
      fc.property(safeCost(), safeMargin(), (cost, margin) => {
        const result = createCostResult('ai.test.op', cost, margin)
        return result.marginCostInCreditsDecimillicents >= cost
      }),
      { numRuns: 200 }
    )
  })

  it('always produces integer ledger amounts', () => {
    fc.assert(
      fc.property(safeCost(), safeMargin(), (cost, margin) => {
        const result = createCostResult('ai.test.op', cost, margin)
        return (
          Number.isInteger(result.costInCreditsDecimillicents)
          && Number.isInteger(result.marginCostInCreditsDecimillicents)
        )
      }),
      { numRuns: 200 }
    )
  })

  it('ceiling-rounded: marginCost matches the closed-form ceil expression', () => {
    fc.assert(
      fc.property(safeCost(), safeMargin(), (cost, margin) => {
        const result = createCostResult('ai.test.op', cost, margin)
        const basisPoints = Math.round(margin * 10_000)
        const expected = Math.ceil((cost * basisPoints) / 10_000)
        return result.marginCostInCreditsDecimillicents === expected
      }),
      { numRuns: 200 }
    )
  })

  it('zero cost maps to zero margin cost at any valid margin', () => {
    fc.assert(
      fc.property(safeMargin(), (margin) => {
        const result = createCostResult('ai.test.op', 0, margin)
        return (
          result.costInCreditsDecimillicents === 0
          && result.marginCostInCreditsDecimillicents === 0
        )
      }),
      { numRuns: 50 }
    )
  })

  it('identity margin (1.0) yields marginCost === baseCost', () => {
    fc.assert(
      fc.property(safeCost(), (cost) => {
        const result = createCostResult('ai.test.op', cost, 1)
        return result.marginCostInCreditsDecimillicents === cost
      }),
      { numRuns: 200 }
    )
  })
})

describe('aggregateCosts properties', () => {
  const costArb = () =>
    fc.array(
      fc.record({
        name: fc.constant('ai.test.op'),
        cost: safeCost()
      }),
      { minLength: 0, maxLength: 20 }
    )

  const build = (entries: ReadonlyArray<{ name: string; cost: number }>) =>
    entries.map((e) => createCostResult(e.name, e.cost))

  it('empty array produces zero totals', () => {
    const agg = aggregateCosts([])
    expect(agg.totalCostInCreditsDecimillicents).toBe(0)
    expect(agg.totalMarginCostInCreditsDecimillicents).toBe(0)
    expect(agg.breakdown).toEqual([])
  })

  it('commutative: summing in any order produces the same totals', () => {
    fc.assert(
      fc.property(costArb(), (entries) => {
        const costsA = build(entries)
        // Deterministic shuffle: reverse. fast-check has no stable
        // permutation helper, but reversing is a distinct order that
        // exposes any accumulator-order dependency.
        const costsB = [...costsA].reverse()
        const aggA = aggregateCosts(costsA)
        const aggB = aggregateCosts(costsB)
        return (
          aggA.totalCostInCreditsDecimillicents === aggB.totalCostInCreditsDecimillicents
          && aggA.totalMarginCostInCreditsDecimillicents
            === aggB.totalMarginCostInCreditsDecimillicents
        )
      }),
      { numRuns: 100 }
    )
  })

  it('linear: total equals the direct sum of each breakdown row', () => {
    fc.assert(
      fc.property(costArb(), (entries) => {
        const costs = build(entries)
        const agg = aggregateCosts(costs)
        const expectedCost = costs.reduce(
          (sum, c) => sum + c.costInCreditsDecimillicents,
          0
        )
        const expectedMargin = costs.reduce(
          (sum, c) => sum + c.marginCostInCreditsDecimillicents,
          0
        )
        return (
          agg.totalCostInCreditsDecimillicents === expectedCost
          && agg.totalMarginCostInCreditsDecimillicents === expectedMargin
        )
      }),
      { numRuns: 100 }
    )
  })

  it('margin-cost total >= base-cost total (no undercharge at aggregate level)', () => {
    fc.assert(
      fc.property(costArb(), (entries) => {
        const costs = build(entries)
        const agg = aggregateCosts(costs)
        return (
          agg.totalMarginCostInCreditsDecimillicents
            >= agg.totalCostInCreditsDecimillicents
        )
      }),
      { numRuns: 100 }
    )
  })

  it('preserves breakdown identity', () => {
    fc.assert(
      fc.property(costArb(), (entries) => {
        const costs = build(entries)
        const agg = aggregateCosts(costs)
        return agg.breakdown === costs
      }),
      { numRuns: 50 }
    )
  })
})

describe('createCostResult default-margin regression', () => {
  it('applies the DEFAULT_MARGIN_MULTIPLIER exactly when margin is omitted', () => {
    fc.assert(
      fc.property(safeCost(), (cost) => {
        const auto = createCostResult('ai.test.op', cost)
        const explicit = createCostResult('ai.test.op', cost, DEFAULT_MARGIN_MULTIPLIER)
        return auto.marginCostInCreditsDecimillicents === explicit.marginCostInCreditsDecimillicents
      }),
      { numRuns: 200 }
    )
  })
})
