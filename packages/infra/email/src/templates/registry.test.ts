import { campaignDefinitions, lifecycleTemplateIds } from '@tx-agent-kit/contracts'
import { describe, expect, it } from 'vitest'
import type { LifecycleEmailProps } from './lifecycle/props.js'
import { renderEmailTemplate, templateRenderers } from './registry.js'

const EM_DASH = '—'

const sampleProps: LifecycleEmailProps = {
  userName: 'Ada',
  ctaUrl: 'https://app.example.com/dashboard',
  feedbackBoardUrl: 'https://example.com/board',
  roadmapUrl: 'https://example.com/roadmap',
  appUrl: 'https://app.example.com/',
  creditBalanceUsd: '$20.00',
  unsubscribeUrl: 'https://app.example.com/unsubscribe?token=abc'
}

describe('lifecycle email registry', () => {
  it('has a renderer for every lifecycle template id', () => {
    for (const id of lifecycleTemplateIds) {
      expect(templateRenderers[id], `missing renderer for ${id}`).toBeTypeOf('function')
    }
  })

  for (const id of lifecycleTemplateIds) {
    it(`renders ${id} to non-empty html + text with no em dash`, async () => {
      const result = await renderEmailTemplate(id, sampleProps)
      expect(result, `expected a result for ${id}`).not.toBeNull()
      // Narrow for TypeScript after the null assertion above.
      if (result === null) {
        throw new Error(`renderEmailTemplate returned null for ${id}`)
      }

      expect(result.html.trim().length).toBeGreaterThan(0)
      expect(result.text.trim().length).toBeGreaterThan(0)

      expect(result.html, `em dash leaked into ${id} html`).not.toContain(EM_DASH)
      expect(result.text, `em dash leaked into ${id} text`).not.toContain(EM_DASH)
    })
  }

  it('renders identically through templateRenderers (html) and the registry', async () => {
    for (const id of lifecycleTemplateIds) {
      const direct = await templateRenderers[id](sampleProps)
      expect(direct).not.toContain(EM_DASH)
      expect(direct.trim().length).toBeGreaterThan(0)
    }
  })

  it('tolerates missing optional props without throwing', async () => {
    for (const id of lifecycleTemplateIds) {
      const result = await renderEmailTemplate(id, { userName: '' })
      expect(result, `expected a result for ${id} with minimal props`).not.toBeNull()
      if (result === null) {
        throw new Error(`renderEmailTemplate returned null for ${id}`)
      }
      expect(result.html).not.toContain(EM_DASH)
      expect(result.text).not.toContain(EM_DASH)
      expect(result.html.trim().length).toBeGreaterThan(0)
    }
  })

  it('renders every templateId referenced by a campaign definition (no config drift)', async () => {
    const referenced = [...new Set(campaignDefinitions.flatMap((def) => def.steps.map((step) => step.templateId)))]
    expect(referenced.length, 'definitions reference at least one template').toBeGreaterThan(0)
    for (const id of referenced) {
      expect(templateRenderers[id], `a definition references ${id} but the registry has no renderer`).toBeTypeOf(
        'function'
      )
      const result = await renderEmailTemplate(id, sampleProps)
      expect(result, `definition templateId ${id} should render`).not.toBeNull()
    }
  })

  it('returns null for an unknown template id', async () => {
    expect(await renderEmailTemplate('bogus/id', sampleProps)).toBeNull()
    expect(await renderEmailTemplate('lifecycle/does-not-exist', sampleProps)).toBeNull()
    expect(await renderEmailTemplate('', sampleProps)).toBeNull()
  })
})
