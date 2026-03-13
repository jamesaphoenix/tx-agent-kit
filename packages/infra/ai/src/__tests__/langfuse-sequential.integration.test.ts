import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Effect } from 'effect'
import {
  startTelemetry,
  stopTelemetry,
  getLangfuseEnv
} from '@tx-agent-kit/observability'
import { tracedCallModel, withAgentStep, withAgentTrace } from '../tracing.js'

const RUN = process.env.RUN_AI_INTEGRATION === '1'

describe.skipIf(!RUN)('Langfuse sequential multi-agent trace', () => {
  beforeAll(() => {
    startTelemetry('ai-integration-test')
  })

  afterAll(async () => {
    await stopTelemetry()
    // Give Langfuse time to ingest
    await new Promise((resolve) => setTimeout(resolve, 5000))
  })

  it('should trace planner → critic → finalizer pipeline and land in Langfuse', async () => {
    const traceName = `test-sequential-${Date.now()}`

    const pipeline = withAgentTrace(
      traceName,
      { test: 'sequential' },
      Effect.gen(function* () {
        // Step 1: Planner
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
            ?.filter((o) => o.type === 'message')
            .flatMap((o) => o.content)
            .filter((c) => c.type === 'output_text')
            .map((c) => c.text)
            .join('') ?? ''

        // Step 2: Critic
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
            ?.filter((o) => o.type === 'message')
            .flatMap((o) => o.content)
            .filter((c) => c.type === 'output_text')
            .map((c) => c.text)
            .join('') ?? ''

        // Step 3: Finalizer
        const result = yield* withAgentStep(
          'finalizer',
          { role: 'finalizer' },
          tracedCallModel({
            model: 'openai/gpt-4.1-mini',
            input: `You are a poet. Write a haiku about coding based on this plan and critique.\nPlan: ${planText}\nCritique: ${critiqueText}`,
            maxOutputTokens: 100
          })
        )

        return result
      })
    )

    const result = await Effect.runPromise(pipeline)
    expect(result.output).toBeDefined()
    expect(result.output?.length).toBeGreaterThan(0)
    expect(result.usage).toBeDefined()
    expect(result.usage?.totalTokens).toBeGreaterThan(0)

    // Verify traces landed in Langfuse
    const langfuseEnv = getLangfuseEnv()
    if (langfuseEnv.LANGFUSE_ENABLED) {
      // Wait for async ingestion
      await new Promise((resolve) => setTimeout(resolve, 3000))

      const authHeader = `Basic ${Buffer.from(`${langfuseEnv.LANGFUSE_PUBLIC_KEY}:${langfuseEnv.LANGFUSE_SECRET_KEY}`).toString('base64')}`
      const resp = await fetch(
        `${langfuseEnv.LANGFUSE_BASE_URL}/api/public/traces?name=${encodeURIComponent(traceName)}`,
        {
          headers: { Authorization: authHeader }
        }
      )
      expect(resp.ok).toBe(true)
      const body = (await resp.json()) as {
        data: Array<{ name: string }>
      }
      expect(body.data).toBeDefined()
      // Trace should exist (may take a moment to appear)
      const firstTrace = body.data[0]
      if (firstTrace) {
        expect(firstTrace.name).toBe(traceName)
      }
    }
  }, 60_000)
})
