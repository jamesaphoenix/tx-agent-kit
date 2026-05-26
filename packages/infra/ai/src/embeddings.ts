import { Effect } from 'effect'
import { OpenRouter } from '@openrouter/sdk'
import type { HTTPClient } from '@openrouter/sdk/lib/http'
import type {
  CreateEmbeddingsRequest,
  CreateEmbeddingsResponse
} from '@openrouter/sdk/models/operations'
import { getAiEnv } from './env.js'
import { AiError } from './errors.js'

export type EmbeddingsRequest = CreateEmbeddingsRequest
export type EmbeddingsResult = CreateEmbeddingsResponse

let clientInstance: OpenRouter | null = null
let httpClientOverride: HTTPClient | null = null

export const resetEmbeddingsClientForTests = (): void => {
  clientInstance = null
}

export const setEmbeddingsHttpClientForTests = (client: HTTPClient | null): void => {
  httpClientOverride = client
  clientInstance = null
}

const getClient = (): OpenRouter => {
  if (clientInstance) {
    return clientInstance
  }

  const env = getAiEnv()
  if (env.OPENROUTER_API_KEY.length === 0) {
    throw new Error('OPENROUTER_API_KEY is required to call OpenRouter APIs')
  }

  clientInstance = new OpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    ...(httpClientOverride ? { httpClient: httpClientOverride } : {}),
    ...(env.OPENROUTER_BASE_URL.length > 0 ? { serverURL: env.OPENROUTER_BASE_URL } : {})
  })
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
