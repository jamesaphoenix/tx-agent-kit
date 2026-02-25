import { Effect } from 'effect'
import { OpenRouter } from '@openrouter/sdk'
import type { CallModelInput, Tool } from '@openrouter/sdk'
import type { ModelResult } from '@openrouter/sdk/lib/model-result'
import { getAiEnv } from './env.js'
import { AiError } from './errors.js'

export type { CallModelInput, Tool }
export type { ModelResult }

let clientInstance: OpenRouter | null = null

const getClient = (): OpenRouter => {
  if (clientInstance) {
    return clientInstance
  }

  const env = getAiEnv()
  if (env.OPENROUTER_API_KEY.length === 0) {
    throw new Error('OPENROUTER_API_KEY is required to call OpenRouter APIs')
  }

  clientInstance = new OpenRouter({ apiKey: env.OPENROUTER_API_KEY })
  return clientInstance
}

const withDefaultModel = <TTools extends readonly Tool[]>(
  request: CallModelInput<TTools>,
  defaultModel: string
): CallModelInput<TTools> => ({
  ...request,
  model: request.model ?? defaultModel
})

export const callModel = <TTools extends readonly Tool[]>(
  request: CallModelInput<TTools>
): Effect.Effect<ModelResult<TTools>, AiError> =>
  Effect.try({
    try: () => {
      const env = getAiEnv()
      return getClient().callModel(
        withDefaultModel(request, env.OPENROUTER_MODEL)
      )
    },
    catch: (error) => new AiError({ message: String(error) })
  })
