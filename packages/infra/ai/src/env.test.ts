import { afterEach, describe, expect, it } from 'vitest'
import { getAiEnv } from './env.js'

const originalEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENROUTER_EMBEDDING_MODEL: process.env.OPENROUTER_EMBEDDING_MODEL
}

afterEach(() => {
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY
  process.env.OPENROUTER_MODEL = originalEnv.OPENROUTER_MODEL
  process.env.OPENROUTER_EMBEDDING_MODEL = originalEnv.OPENROUTER_EMBEDDING_MODEL
})

describe('getAiEnv', () => {
  it('returns defaults when optional variables are unset', () => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_MODEL
    delete process.env.OPENROUTER_EMBEDDING_MODEL

    const env = getAiEnv()

    expect(env.OPENROUTER_API_KEY).toBe('')
    expect(env.OPENROUTER_MODEL).toBe('openai/gpt-4.1-mini')
    expect(env.OPENROUTER_EMBEDDING_MODEL).toBe('openai/text-embedding-3-small')
  })
})
