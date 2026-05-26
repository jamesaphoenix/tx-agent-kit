import { afterEach, describe, expect, it } from 'vitest'
import { clearAiEnvOverrides, getAiEnv, setAiEnvOverride } from './env.js'

const originalEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENROUTER_EMBEDDING_MODEL: process.env.OPENROUTER_EMBEDDING_MODEL
}

afterEach(() => {
  clearAiEnvOverrides()
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY
  process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL
  process.env.OPENROUTER_MODEL = originalEnv.OPENROUTER_MODEL
  process.env.OPENROUTER_EMBEDDING_MODEL = originalEnv.OPENROUTER_EMBEDDING_MODEL
})

describe('getAiEnv', () => {
  it('returns defaults when optional variables are unset', () => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_BASE_URL
    delete process.env.OPENROUTER_MODEL
    delete process.env.OPENROUTER_EMBEDDING_MODEL

    const env = getAiEnv()

    expect(env.OPENROUTER_API_KEY).toBe('')
    expect(env.OPENROUTER_BASE_URL).toBe('')
    expect(env.OPENROUTER_MODEL).toBe('openai/gpt-4.1-mini')
    expect(env.OPENROUTER_EMBEDDING_MODEL).toBe('openai/text-embedding-3-small')
  })

  it('supports test overrides without mutating process env', () => {
    process.env.OPENROUTER_BASE_URL = 'https://live.example.test'
    setAiEnvOverride('OPENROUTER_BASE_URL', 'https://fake.example.test')

    expect(getAiEnv().OPENROUTER_BASE_URL).toBe('https://fake.example.test')
    expect(process.env.OPENROUTER_BASE_URL).toBe('https://live.example.test')

    clearAiEnvOverrides()

    expect(getAiEnv().OPENROUTER_BASE_URL).toBe('https://live.example.test')
  })
})
