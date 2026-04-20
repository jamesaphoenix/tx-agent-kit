import { SpanKind } from '@opentelemetry/api'
import { afterEach, describe, expect, it } from 'vitest'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanExporter
} from '@opentelemetry/sdk-trace-base'

import { getObservabilityEnv } from './env.js'
import { createLangfuseShouldExportSpan } from './langfuse.js'

const originalEnvSnapshot = { ...process.env }

class CapturingSpanExporter implements SpanExporter {
  readonly exportedSpans: ReadableSpan[] = []

  export(
    spans: Parameters<SpanExporter['export']>[0],
    resultCallback: Parameters<SpanExporter['export']>[1]
  ): void {
    this.exportedSpans.push(...spans)
    resultCallback({ code: 0 })
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

const resetEnv = () => {
  process.env = { ...originalEnvSnapshot }
  delete process.env.NODE_ENV
  delete process.env.LANGFUSE_ENABLED
  delete process.env.LANGFUSE_BASE_URL
  delete process.env.LANGFUSE_HOST
  delete process.env.LANGFUSE_PUBLIC_KEY
  delete process.env.LANGFUSE_SECRET_KEY
  delete process.env.LANGFUSE_SAMPLE_RATE
  delete process.env.LANGFUSE_LOG_LEVEL
  delete process.env.LANGFUSE_TRACING_ENVIRONMENT
  delete process.env.LANGFUSE_RELEASE
}

const fakeSpan = (
  instrumentationScopeName: string,
  attributes: ReadableSpan['attributes']
): ReadableSpan =>
  ({
    name: 'fake',
    attributes,
    instrumentationScope: {
      name: instrumentationScopeName
    },
    spanContext: () => ({
      traceId: '00000001000000000000000000000000',
      spanId: '0000000000000001',
      traceFlags: 1
    })
  }) as ReadableSpan

afterEach(() => {
  process.env = { ...originalEnvSnapshot }
})

describe('Langfuse environment integration', () => {
  it.each([
    {
      label: 'local',
      nodeEnv: 'development',
      baseUrl: 'http://localhost:3003'
    },
    {
      label: 'staging',
      nodeEnv: 'staging',
      baseUrl: 'https://us.cloud.langfuse.com'
    },
    {
      label: 'prod',
      nodeEnv: 'production',
      baseUrl: 'https://us.cloud.langfuse.com'
    }
  ])(
    'resolves $label Langfuse settings and keeps export LLM-only',
    ({ nodeEnv, baseUrl }) => {
      resetEnv()
      process.env.NODE_ENV = nodeEnv
      process.env.LANGFUSE_ENABLED = 'true'
      process.env.LANGFUSE_BASE_URL = baseUrl
      process.env.LANGFUSE_PUBLIC_KEY = `pk-lf-${nodeEnv}-test`
      process.env.LANGFUSE_SECRET_KEY = `sk-lf-${nodeEnv}-test`
      process.env.LANGFUSE_SAMPLE_RATE = '1'

      const env = getObservabilityEnv()

      expect(env.LANGFUSE).toEqual(
        expect.objectContaining({
          enabled: true,
          baseUrl,
          publicKey: `pk-lf-${nodeEnv}-test`,
          secretKey: `sk-lf-${nodeEnv}-test`,
          environment: nodeEnv,
          sampleRate: 1
        })
      )

      const shouldExport = createLangfuseShouldExportSpan(
        env.LANGFUSE.sampleRate
      )

      expect(
        shouldExport({
          otelSpan: fakeSpan('tx-agent-kit.ai', {
            'gen_ai.system': 'openrouter',
            'gen_ai.request.model': 'openai/gpt-4.1-mini'
          })
        })
      ).toBe(true)

      expect(
        shouldExport({
          otelSpan: fakeSpan('@opentelemetry/instrumentation-pg', {
            'db.system': 'postgresql',
            'db.statement': 'select * from messages'
          })
        })
      ).toBe(false)
    }
  )
})

describe('Langfuse processor export integration', () => {
  it('exports LLM spans and drops database spans before they reach Langfuse', async () => {
    const exporter = new CapturingSpanExporter()
    const processor = new LangfuseSpanProcessor({
      exporter,
      publicKey: 'pk-lf-integration-test',
      secretKey: 'sk-lf-integration-test',
      baseUrl: 'http://localhost:3003',
      environment: 'test',
      exportMode: 'immediate',
      shouldExportSpan: createLangfuseShouldExportSpan(1)
    })
    const provider = new BasicTracerProvider({
      spanProcessors: [processor]
    })
    const tracer = provider.getTracer('tx-agent-kit.langfuse.integration')

    const databaseSpan = tracer.startSpan('db.query messages', {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'postgresql',
        'db.operation': 'SELECT',
        'db.statement': 'select * from messages'
      }
    })
    databaseSpan.end()

    const llmSpan = tracer.startSpan(
      'gen_ai.chat.completions openai/gpt-4.1-mini',
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'gen_ai.system': 'openrouter',
          'gen_ai.request.model': 'openai/gpt-4.1-mini',
          'gen_ai.response.model': 'openai/gpt-4.1-mini',
          'gen_ai.usage.prompt_tokens': 4,
          'gen_ai.usage.completion_tokens': 2,
          'gen_ai.usage.total_tokens': 6,
          'langfuse.observation.type': 'generation',
          'langfuse.observation.input': '"integration smoke input"',
          'langfuse.observation.output': '"integration smoke output"',
          'langfuse.observation.model.name': 'openai/gpt-4.1-mini',
          'langfuse.observation.metadata.provider': 'openrouter'
        }
      }
    )
    llmSpan.end()

    await provider.forceFlush()
    await provider.shutdown()

    expect(exporter.exportedSpans).toHaveLength(1)
    expect(exporter.exportedSpans[0]?.name).toBe(
      'gen_ai.chat.completions openai/gpt-4.1-mini'
    )
    expect(exporter.exportedSpans[0]?.attributes).toMatchObject({
      'gen_ai.system': 'openrouter',
      'langfuse.observation.type': 'generation'
    })
    expect(
      exporter.exportedSpans.some((span) => span.attributes['db.system'])
    ).toBe(false)
  })
})
