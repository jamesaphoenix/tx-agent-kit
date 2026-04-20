import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  startTelemetry,
  stopTelemetry
} from '@tx-agent-kit/observability'
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

  describe('OTel sequential multi-agent trace', () => {
    beforeAll(() => {
      startTelemetry('ai-integration-test')
    })

    afterAll(async () => {
      await stopTelemetry()
      await new Promise((resolve) => setTimeout(resolve, 5000))
    })

    it.skipIf(!shouldRunAiIntegration)(
      'traces a planner, critic, and finalizer pipeline via OTel',
      async () => {
        const traceName = `test-sequential-${Date.now()}`

        const pipeline = withAgentTrace(
          traceName,
          { test: 'sequential' },
          Effect.gen(function* () {
            const plan = yield* withAgentStep(
              'planner',
              { role: 'planner' },
              tracedCallModel({
                model: 'openai/gpt-4.1-mini',
                input:
                  'You are a planner. Create a brief 2-sentence plan for writing a haiku about coding.',
                maxOutputTokens: 150
              })
            )

            const planText =
              plan.output
                ?.filter((output) => output.type === 'message')
                .flatMap((output) => output.content)
                .filter((content) => content.type === 'output_text')
                .map((content) => content.text)
                .join('') ?? ''

            const critique = yield* withAgentStep(
              'critic',
              { role: 'critic' },
              tracedCallModel({
                model: 'openai/gpt-4.1-mini',
                input: `You are a critic. Review this plan and suggest one improvement in 1 sentence: ${planText}`,
                maxOutputTokens: 100
              })
            )

            const critiqueText =
              critique.output
                ?.filter((output) => output.type === 'message')
                .flatMap((output) => output.content)
                .filter((content) => content.type === 'output_text')
                .map((content) => content.text)
                .join('') ?? ''

            return yield* withAgentStep(
              'finalizer',
              { role: 'finalizer' },
              tracedCallModel({
                model: 'openai/gpt-4.1-mini',
                input: `You are a poet. Write a haiku about coding based on this plan and critique.\nPlan: ${planText}\nCritique: ${critiqueText}`,
                maxOutputTokens: 100
              })
            )
          })
        )

        const result = await Effect.runPromise(pipeline)
        expect(result.output).toBeDefined()
        expect(result.output?.length).toBeGreaterThan(0)
        expect(result.usage).toBeDefined()
        expect(result.usage?.totalTokens).toBeGreaterThan(0)
      },
      60_000
    )
  })
})
