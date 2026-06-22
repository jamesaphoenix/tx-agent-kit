import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import {
  campaignDefinitionSchema,
  campaignDefinitions
} from './email-campaign-definitions.js'
import { domainEventTypes, lifecycleTemplateIds } from './literals.js'

const decode = Schema.decodeUnknownEither(campaignDefinitionSchema)

describe('campaignDefinitions', () => {
  it('every definition decodes against the schema', () => {
    for (const def of campaignDefinitions) {
      const result = decode(def)
      expect(result._tag, `${def.slug} should decode`).toBe('Right')
    }
  })

  it('every step templateId is a known lifecycle template id', () => {
    const ids = new Set<string>(lifecycleTemplateIds)
    for (const def of campaignDefinitions) {
      for (const step of def.steps) {
        expect(ids.has(step.templateId), `${def.slug} step ${step.stepOrder}`).toBe(true)
      }
    }
  })

  it('every trigger eventType is a registered domain event', () => {
    const events = new Set<string>(domainEventTypes)
    for (const def of campaignDefinitions) {
      expect(events.has(def.trigger.eventType), def.slug).toBe(true)
    }
  })

  it('step orders are unique and contiguous from 1 per campaign', () => {
    for (const def of campaignDefinitions) {
      const orders = def.steps.map((s) => s.stepOrder)
      expect(new Set(orders).size, `${def.slug} unique`).toBe(orders.length)
      const sorted = [...orders].sort((a, b) => a - b)
      expect(sorted, `${def.slug} contiguous`).toEqual(sorted.map((_, i) => i + 1))
    }
  })

  it('campaign slugs are unique', () => {
    const slugs = campaignDefinitions.map((d) => d.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
