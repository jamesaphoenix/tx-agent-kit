export interface AiEnv {
  OPENROUTER_API_KEY: string
  OPENROUTER_MODEL: string
  OPENROUTER_EMBEDDING_MODEL: string
}

const defaultChatModel = 'openai/gpt-4.1-mini'
const defaultEmbeddingModel = 'openai/text-embedding-3-small'

export const getAiEnv = (): AiEnv => {
  return {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? defaultChatModel,
    OPENROUTER_EMBEDDING_MODEL: process.env.OPENROUTER_EMBEDDING_MODEL ?? defaultEmbeddingModel
  }
}
