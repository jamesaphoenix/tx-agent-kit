import { describe, expect, it } from 'vitest'
import {
  aggregateCosts,
  createCostResult,
  createCostResultFromOpenRouterUsage,
  DECIMILLICENTS_PER_CENT,
  DECIMILLICENTS_PER_DOLLAR,
  DEFAULT_MARGIN_MULTIPLIER,
  fromDecimillicents,
  groupCostsByService,
  toDecimillicents,
  validateCostNames
} from './billing.js'

describe('billing money helpers', () => {
  it('defines the expected decimillicent constants', () => {
    expect(DECIMILLICENTS_PER_CENT).toBe(100_000)
    expect(DECIMILLICENTS_PER_DOLLAR).toBe(10_000_000)
  })

  it('converts dollars to decimillicents', () => {
    expect(toDecimillicents(1)).toBe(10_000_000)
    expect(toDecimillicents(0.0001)).toBe(1000)
  })

  it('converts decimillicents back to dollars', () => {
    expect(fromDecimillicents(10_000_000)).toBe(1)
    expect(fromDecimillicents(1000)).toBe(0.0001)
  })
})

// @spec INV-BILLING-006 — 1.10x markup on all AI cost pass-through.
// @spec REQ-BILLING-005 — per-operation CostResult includes exactly 1.10x markup.
describe('CostResult + margin [INV-BILLING-006] [REQ-BILLING-005]', () => {
  it('uses a default margin multiplier of 1.10 (10% markup)', () => {
    expect(DEFAULT_MARGIN_MULTIPLIER).toBe(1.10)
  })

  it('applies the 1.10x markup at creation time and rounds up', () => {
    // Base cost: 1_000_000 decimillicents = $0.10
    // With 10% markup: 1_100_000 decimillicents = $0.11
    const cost = createCostResult('ai.text_generation.gpt-5', 1_000_000)
    expect(cost.name).toBe('ai.text_generation.gpt-5')
    expect(cost.costInCreditsDecimillicents).toBe(1_000_000)
    expect(cost.costInDollars).toBe(0.1)
    expect(cost.marginCostInCreditsDecimillicents).toBe(1_100_000)
    expect(cost.marginCostInDollars).toBe(0.11)
  })

  it('rounds the margin up with Math.ceil to prevent sub-unit undercharging', () => {
    // 333 decimillicents * 1.10 = 366.3 → ceil → 367
    const cost = createCostResult('ai.image_generation.gpt-image-1', 333)
    expect(cost.marginCostInCreditsDecimillicents).toBe(367)
  })

  it('accepts a custom margin multiplier for configurable pricing', () => {
    const cost = createCostResult('ai.video_generation.veo-3', 1_000_000, 1.5)
    expect(cost.marginCostInCreditsDecimillicents).toBe(1_500_000)
  })

  it('handles zero-cost operations cleanly', () => {
    const cost = createCostResult('ai.embedding.text-embedding-3-small', 0)
    expect(cost.costInCreditsDecimillicents).toBe(0)
    expect(cost.marginCostInCreditsDecimillicents).toBe(0)
    expect(cost.marginCostInDollars).toBe(0)
  })

  // @spec INV-BILLING-006 — input validation must reject silent money-loss
  // patterns at the contract boundary so a programmer error at the call
  // site fails loudly instead of surfacing as a free-to-customer operation.
  describe('input validation', () => {
    it('rejects NaN cost', () => {
      expect(() => createCostResult('ai.text_generation.gpt-5', Number.NaN)).toThrow(
        /costInCreditsDecimillicents/
      )
    })

    it('rejects Infinity cost', () => {
      expect(() =>
        createCostResult('ai.text_generation.gpt-5', Number.POSITIVE_INFINITY)
      ).toThrow(/costInCreditsDecimillicents/)
    })

    it('rejects negative cost', () => {
      expect(() => createCostResult('ai.text_generation.gpt-5', -1)).toThrow(
        /costInCreditsDecimillicents/
      )
    })

    it('rejects non-integer cost', () => {
      expect(() => createCostResult('ai.text_generation.gpt-5', 1.5)).toThrow(
        /costInCreditsDecimillicents/
      )
    })

    it('rejects marginMultiplier = 0 (would silently zero the customer bill)', () => {
      expect(() => createCostResult('ai.text_generation.gpt-5', 1_000_000, 0)).toThrow(
        /marginMultiplier/
      )
    })

    it('rejects marginMultiplier < 1 (a discount below cost leaks infra margin)', () => {
      expect(() => createCostResult('ai.text_generation.gpt-5', 1_000_000, 0.5)).toThrow(
        /marginMultiplier/
      )
    })

    it('rejects NaN marginMultiplier', () => {
      expect(() =>
        createCostResult('ai.text_generation.gpt-5', 1_000_000, Number.NaN)
      ).toThrow(/marginMultiplier/)
    })

    it('rejects Infinity marginMultiplier', () => {
      expect(() =>
        createCostResult('ai.text_generation.gpt-5', 1_000_000, Number.POSITIVE_INFINITY)
      ).toThrow(/marginMultiplier/)
    })

    it('accepts marginMultiplier = 1 (no markup, pass-through)', () => {
      const cost = createCostResult('ai.text_generation.gpt-5', 1_000_000, 1)
      expect(cost.marginCostInCreditsDecimillicents).toBe(1_000_000)
    })
  })
})

describe('aggregateCosts', () => {
  it('sums totals and preserves the breakdown', () => {
    const costs = [
      createCostResult('ai.text_generation.gpt-5', 500_000),
      createCostResult('ai.image_generation.gpt-image-1', 1_000_000)
    ]

    const agg = aggregateCosts(costs)
    expect(agg.totalCostInCreditsDecimillicents).toBe(1_500_000)
    expect(agg.totalMarginCostInCreditsDecimillicents).toBe(550_000 + 1_100_000)
    expect(agg.totalCostInDollars).toBe(0.15)
    expect(agg.breakdown).toHaveLength(2)
    expect(agg.breakdown[0]?.name).toBe('ai.text_generation.gpt-5')
  })

  it('returns zero totals for an empty array', () => {
    const agg = aggregateCosts([])
    expect(agg.totalCostInCreditsDecimillicents).toBe(0)
    expect(agg.totalMarginCostInCreditsDecimillicents).toBe(0)
    expect(agg.breakdown).toHaveLength(0)
  })
})

describe('groupCostsByService', () => {
  it('groups by the first segment of the operation name', () => {
    const costs = [
      createCostResult('ai.text_generation.gpt-5', 100),
      createCostResult('ai.image_generation.gpt-image-1', 200),
      createCostResult('media.transcoding.ffmpeg', 300)
    ]

    const grouped = groupCostsByService(costs)
    expect(Object.keys(grouped).sort()).toEqual(['ai', 'media'])
    expect(grouped.ai).toHaveLength(2)
    expect(grouped.media).toHaveLength(1)
  })

  it('groups entries with no service prefix under `unknown`', () => {
    const costs = [{ ...createCostResult('', 100), name: '' }]
    const grouped = groupCostsByService(costs)
    // Empty name → split('.')[0] = '' → falsy → 'unknown'
    expect(Object.keys(grouped)).toContain('unknown')
  })
})

describe('validateCostNames', () => {
  it('accepts named costs', () => {
    const costs = [createCostResult('ai.text_generation.gpt-5', 100)]
    expect(() => validateCostNames(costs)).not.toThrow()
  })

  it('throws when any CostResult has an empty name', () => {
    const costs = [
      createCostResult('ai.text_generation.gpt-5', 100),
      { ...createCostResult('ai.image_generation.x', 100), name: '   ' }
    ]
    expect(() => validateCostNames(costs)).toThrow(/name is required/)
  })
})

// @spec INV-BILLING-006
describe('createCostResultFromOpenRouterUsage', () => {
  it('extracts dollar cost from OpenRouter usage and applies the 1.10x markup', () => {
    const response = {
      model: 'openai/gpt-5',
      usage: { cost: 0.02 } // $0.02
    }
    const cost = createCostResultFromOpenRouterUsage(response)
    expect(cost.name).toBe('ai.text_generation.openai/gpt-5')
    // $0.02 = 200_000 decimillicents → 220_000 with 10% markup
    expect(cost.costInCreditsDecimillicents).toBe(200_000)
    expect(cost.marginCostInCreditsDecimillicents).toBe(220_000)
    expect(cost.costInDollars).toBe(0.02)
    expect(cost.marginCostInDollars).toBe(0.022)
  })

  it('handles missing usage block as zero cost', () => {
    const cost = createCostResultFromOpenRouterUsage({ model: 'anthropic/claude-4' })
    expect(cost.costInCreditsDecimillicents).toBe(0)
    expect(cost.marginCostInCreditsDecimillicents).toBe(0)
  })

  it('handles null cost from OpenRouter as zero cost', () => {
    const cost = createCostResultFromOpenRouterUsage({
      model: 'anthropic/claude-4',
      usage: { cost: null }
    })
    expect(cost.costInCreditsDecimillicents).toBe(0)
  })

  it('accepts a custom operation tag for image / embedding / video routes', () => {
    const cost = createCostResultFromOpenRouterUsage(
      { model: 'openai/gpt-image-1', usage: { cost: 0.001 } },
      'image_generation'
    )
    expect(cost.name).toBe('ai.image_generation.openai/gpt-image-1')
  })

  it('accepts a custom margin multiplier override', () => {
    const cost = createCostResultFromOpenRouterUsage(
      { model: 'openai/gpt-5', usage: { cost: 0.01 } },
      'text_generation',
      1.5
    )
    // 100_000 base * 1.5 = 150_000
    expect(cost.marginCostInCreditsDecimillicents).toBe(150_000)
  })
})
