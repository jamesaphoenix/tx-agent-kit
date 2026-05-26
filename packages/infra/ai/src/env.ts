export interface AiEnv {
  OPENROUTER_API_KEY: string
  OPENROUTER_BASE_URL: string
  OPENROUTER_MODEL: string
  OPENROUTER_EMBEDDING_MODEL: string
}

const defaultChatModel = 'openai/gpt-4.1-mini'
const defaultEmbeddingModel = 'openai/text-embedding-3-small'

const aiEnvOverrides: Partial<Record<keyof AiEnv, string | null>> = {}

const readAiEnvValue = (key: keyof AiEnv, fallback: string): string => {
  if (Object.prototype.hasOwnProperty.call(aiEnvOverrides, key)) {
    return aiEnvOverrides[key] ?? fallback
  }
  return process.env[key] ?? fallback
}

export const setAiEnvOverride = (
  key: keyof AiEnv,
  value: string | undefined
): void => {
  aiEnvOverrides[key] = value ?? null
}

export const clearAiEnvOverrides = (): void => {
  delete aiEnvOverrides.OPENROUTER_API_KEY
  delete aiEnvOverrides.OPENROUTER_BASE_URL
  delete aiEnvOverrides.OPENROUTER_MODEL
  delete aiEnvOverrides.OPENROUTER_EMBEDDING_MODEL
}

export const getAiEnv = (): AiEnv => {
  return {
    OPENROUTER_API_KEY: readAiEnvValue('OPENROUTER_API_KEY', ''),
    OPENROUTER_BASE_URL: readAiEnvValue('OPENROUTER_BASE_URL', ''),
    OPENROUTER_MODEL: readAiEnvValue('OPENROUTER_MODEL', defaultChatModel),
    OPENROUTER_EMBEDDING_MODEL: readAiEnvValue(
      'OPENROUTER_EMBEDDING_MODEL',
      defaultEmbeddingModel
    )
  }
}
