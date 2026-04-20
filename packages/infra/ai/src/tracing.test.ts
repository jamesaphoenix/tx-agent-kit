import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const setAttribute = vi.fn()
  const setStatus = vi.fn()
  const end = vi.fn()
  const span = {
    setAttribute,
    setStatus,
    end
  }
  const startSpan = vi.fn(
    (
      _name: string,
      _options: { kind: string; attributes: Record<string, unknown> },
      _context: unknown
    ) => span
  )

  return {
    setAttribute,
    setStatus,
    end,
    span,
    startSpan,
    callModel: vi.fn()
  }
})

vi.mock('@opentelemetry/api', () => ({
  context: {
    active: vi.fn(() => ({ active: true }))
  },
  trace: {
    getTracer: vi.fn(() => ({
      startSpan: mocks.startSpan
    })),
    setSpan: vi.fn((parentContext: unknown, span: unknown) => ({
      parentContext,
      span
    }))
  },
  SpanKind: {
    CLIENT: 'CLIENT'
  },
  SpanStatusCode: {
    ERROR: 'ERROR',
    OK: 'OK'
  }
}))

vi.mock('./env.js', () => ({
  getAiEnv: vi.fn(() => ({
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_MODEL: 'openai/gpt-4.1-mini',
    OPENROUTER_EMBEDDING_MODEL: 'openai/text-embedding-3-small'
  }))
}))

vi.mock('./openrouter.js', () => ({
  callModel: mocks.callModel
}))

describe('tracedCallModel Langfuse attributes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.callModel.mockReturnValue(
      Effect.succeed({
        getResponse: () =>
          Promise.resolve({
            model: 'openai/gpt-4.1-mini',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'hello'
                  }
                ]
              }
            ],
            usage: {
              inputTokens: 10,
              outputTokens: 3,
              totalTokens: 13,
              cost: 0.0001
            }
          })
      })
    )
  })

  it('marks OpenRouter calls as Langfuse generation observations', async () => {
    const { tracedCallModel } = await import('./tracing.js')

    await Effect.runPromise(
      tracedCallModel({
        model: 'openai/gpt-4.1-mini',
        input: 'Reply with hello',
        temperature: 0.2,
        maxOutputTokens: 20
      })
    )

    expect(mocks.startSpan).toHaveBeenCalledTimes(1)
    const startSpanCall = mocks.startSpan.mock.calls[0]
    expect(startSpanCall?.[0]).toBe(
      'gen_ai.chat.completions openai/gpt-4.1-mini'
    )
    expect(startSpanCall?.[1].kind).toBe('CLIENT')
    expect(startSpanCall?.[1].attributes).toMatchObject({
      'gen_ai.system': 'openrouter',
      'gen_ai.request.model': 'openai/gpt-4.1-mini',
      'gen_ai.request.temperature': 0.2,
      'gen_ai.request.max_tokens': 20,
      'langfuse.observation.type': 'generation',
      'langfuse.observation.model.name': 'openai/gpt-4.1-mini',
      'langfuse.observation.metadata.provider': 'openrouter',
      'langfuse.observation.input': '"Reply with hello"',
      'langfuse.observation.model.parameters':
        '{"temperature":0.2,"max_tokens":20}'
    })

    expect(mocks.setAttribute).toHaveBeenCalledWith(
      'langfuse.observation.model.name',
      'openai/gpt-4.1-mini'
    )
    expect(mocks.setAttribute).toHaveBeenCalledWith(
      'langfuse.observation.usage_details',
      '{"input":10,"output":3,"total":13}'
    )
    expect(mocks.setAttribute).toHaveBeenCalledWith(
      'langfuse.observation.cost_details',
      '{"total":0.0001}'
    )
    expect(mocks.setAttribute).toHaveBeenCalledWith(
      'langfuse.observation.output',
      '"hello"'
    )
  })
})
