import { describe, expect, it } from 'vitest'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import {
  createLangfuseShouldExportSpan,
  maskLangfuseData
} from './langfuse.js'

const fakeSpan = (
  instrumentationScopeName: string,
  attributes: ReadableSpan['attributes'],
  traceId = '80000000000000000000000000000000'
): ReadableSpan =>
  ({
    name: 'fake',
    attributes,
    instrumentationScope: {
      name: instrumentationScopeName
    },
    spanContext: () => ({
      traceId,
      spanId: '0000000000000001',
      traceFlags: 1
    })
  }) as ReadableSpan

describe('createLangfuseShouldExportSpan', () => {
  it('exports GenAI spans to Langfuse', () => {
    const shouldExport = createLangfuseShouldExportSpan(1)

    expect(
      shouldExport({
        otelSpan: fakeSpan('tx-agent-kit.ai', {
          'gen_ai.system': 'openrouter',
          'gen_ai.request.model': 'openai/gpt-4.1-mini'
        })
      })
    ).toBe(true)
  })

  it('does not export database or HTTP infrastructure spans', () => {
    const shouldExport = createLangfuseShouldExportSpan(1)

    expect(
      shouldExport({
        otelSpan: fakeSpan('@opentelemetry/instrumentation-pg', {
          'db.system': 'postgresql',
          'db.statement': 'select * from users'
        })
      })
    ).toBe(false)

    expect(
      shouldExport({
        otelSpan: fakeSpan('@opentelemetry/instrumentation-http', {
          'http.method': 'GET',
          'http.route': '/health'
        })
      })
    ).toBe(false)
  })

  it('applies deterministic trace sampling after the LLM-only filter', () => {
    const shouldExportNone = createLangfuseShouldExportSpan(0)
    const shouldExportHalf = createLangfuseShouldExportSpan(0.5)

    expect(
      shouldExportNone({
        otelSpan: fakeSpan('tx-agent-kit.ai', {
          'gen_ai.system': 'openrouter'
        })
      })
    ).toBe(false)

    expect(
      shouldExportHalf({
        otelSpan: fakeSpan(
          'tx-agent-kit.ai',
          {
            'gen_ai.system': 'openrouter'
          },
          '00000001000000000000000000000000'
        )
      })
    ).toBe(true)

    expect(
      shouldExportHalf({
        otelSpan: fakeSpan(
          'tx-agent-kit.ai',
          {
            'gen_ai.system': 'openrouter'
          },
          'ffffffff000000000000000000000000'
        )
      })
    ).toBe(false)
  })
})

describe('maskLangfuseData', () => {
  it('redacts Langfuse, OpenRouter, bearer, and basic auth secrets', () => {
    expect(
      maskLangfuseData({
        data: {
          secret: 'sk-lf-12345678-1234-1234-1234-123456789abc',
          openrouter: 'sk-or-test_token',
          authorization: 'Bearer abc.def.ghi',
          basic: 'Basic abc123=='
        }
      })
    ).toEqual({
      secret: '[REDACTED]',
      openrouter: '[REDACTED]',
      authorization: '[REDACTED]',
      basic: '[REDACTED]'
    })
  })
})
