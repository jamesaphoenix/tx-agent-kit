import { Effect } from 'effect'
import { OpenRouter } from '@openrouter/sdk'
import type {
  CreateEmbeddingsRequest,
  CreateEmbeddingsResponse
} from '@openrouter/sdk/models/operations'
import { getAiEnv } from './env.js'
import { AiError } from './errors.js'

export type EmbeddingsRequest = CreateEmbeddingsRequest
export type EmbeddingsResult = CreateEmbeddingsResponse

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

const withDefaultEmbeddingModel = (
  request: EmbeddingsRequest,
  defaultModel: string
): EmbeddingsRequest => ({
  ...request,
  requestBody: {
    ...request.requestBody,
    model: request.requestBody.model || defaultModel
  }
})

export const embeddingsGenerate = (
  request: EmbeddingsRequest
): Effect.Effect<EmbeddingsResult, AiError> =>
  Effect.tryPromise({
    try: async () => {
      const env = getAiEnv()
      return getClient().embeddings.generate(
        withDefaultEmbeddingModel(request, env.OPENROUTER_EMBEDDING_MODEL)
      )
    },
    catch: (error) => new AiError({ message: String(error) })
  })
