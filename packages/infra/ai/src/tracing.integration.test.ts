import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { tracedCallModel, withAgentStep, withAgentTrace } from './tracing.js'

const shouldRunAiIntegration = process.env.RUN_AI_INTEGRATION === '1'

describe('AI tracing integration', () => {
  describe('tracedCallModel', () => {
    it.skipIf(!shouldRunAiIntegration)(
      'calls OpenRouter and returns a response with token usage',
      async () => {
        const response = await Effect.runPromise(
          tracedCallModel(
            {
              model: 'openai/gpt-4.1-mini',
              input: 'Reply with exactly: "hello"',
              maxOutputTokens: 20
            },
            { stepName: 'test-traced-call' }
          )
        )

        expect(response.model).toBeTruthy()
        expect(response.usage).toBeDefined()
        expect(response.usage?.inputTokens).toBeGreaterThan(0)
        expect(response.usage?.outputTokens).toBeGreaterThan(0)
        expect(response.usage?.totalTokens).toBeGreaterThan(0)
      }
    )
  })

  describe('withAgentStep + tracedCallModel', () => {
    it.skipIf(!shouldRunAiIntegration)(
      'nests a traced model call inside an agent step span',
      async () => {
        const response = await Effect.runPromise(
          withAgentStep(
            'summarize-step',
            { domain: 'test', action: 'summarize' },
            tracedCallModel({
              model: 'openai/gpt-4.1-mini',
              input: 'Reply with exactly one word: "ok"',
              maxOutputTokens: 10
            })
          )
        )

        expect(response.model).toBeTruthy()
        expect(response.usage?.totalTokens).toBeGreaterThan(0)
      }
    )
  })

  describe('withAgentTrace multi-step', () => {
    it.skipIf(!shouldRunAiIntegration)(
      'runs a sequential multi-agent pipeline under one root trace',
      async () => {
        const result = await Effect.runPromise(
          withAgentTrace(
            'content-pipeline',
            { pipeline: 'test', version: '1' },
            Effect.gen(function* () {
              const draft = yield* withAgentStep(
                'draft-step',
                { role: 'drafter' },
                tracedCallModel({
                  model: 'openai/gpt-4.1-mini',
                  input: 'Write a one-sentence draft about testing.',
                  maxOutputTokens: 40
                })
              )

              const draftText = draft.output
                ?.filter((o) => o.type === 'message')
                .flatMap((o) => o.content)
                .filter((c) => c.type === 'output_text')
                .map((c) => c.text)
                .join('') ?? ''

              const review = yield* withAgentStep(
                'review-step',
                { role: 'reviewer' },
                tracedCallModel({
                  model: 'openai/gpt-4.1-mini',
                  input: `Review this draft and reply "approved" or "rejected": ${draftText}`,
                  maxOutputTokens: 20
                })
              )

              return { draft, review }
            })
          )
        )

        expect(result.draft.model).toBeTruthy()
        expect(result.draft.usage?.totalTokens).toBeGreaterThan(0)
        expect(result.review.model).toBeTruthy()
        expect(result.review.usage?.totalTokens).toBeGreaterThan(0)
      }
    )
  })
})
