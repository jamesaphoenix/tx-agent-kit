import { describe, expect, it } from 'vitest'
import { buildAgentEnv } from './env.js'

const hostEnv = {
  HOME: '/Users/test',
  PATH: '/usr/bin',
  CODEX_HOME: '/Users/test/.codex'
}

describe('buildAgentEnv', () => {
  it('forwards the allowlisted host env snapshot it is given', () => {
    const env = buildAgentEnv('codex', {}, hostEnv)
    expect(env.HOME).toBe('/Users/test')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.CODEX_HOME).toBe('/Users/test/.codex')
  })

  it('does not invent keys that were not in the host snapshot', () => {
    const env = buildAgentEnv('codex', {}, hostEnv)
    expect(env.SHOULD_NOT_FORWARD).toBeUndefined()
  })

  it('merges rendered staging/prod secrets into the child env', () => {
    const env = buildAgentEnv(
      'codex',
      { DATABASE_URL: 'postgres://live', STRIPE_SECRET_KEY: 'sk_live_x' },
      hostEnv
    )
    expect(env.DATABASE_URL).toBe('postgres://live')
    expect(env.STRIPE_SECRET_KEY).toBe('sk_live_x')
  })

  it('always strips OPENAI_API_KEY and CODEX_API_KEY (OAuth-only codex)', () => {
    const env = buildAgentEnv(
      'codex',
      { OPENAI_API_KEY: 'sk-x', CODEX_API_KEY: 'cdx-x' },
      hostEnv
    )
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.CODEX_API_KEY).toBeUndefined()
  })

  it('never reintroduces an API key even if a rendered secret carries one', () => {
    const env = buildAgentEnv('codex', { OPENAI_API_KEY: 'sk-from-rendered' }, hostEnv)
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  it('strips ANTHROPIC_API_KEY for the claude runtime (subscription-only)', () => {
    const codexEnv = buildAgentEnv('codex', { ANTHROPIC_API_KEY: 'ant-x' }, hostEnv)
    // For codex we keep ANTHROPIC_API_KEY (not a codex billing key); the claude
    // path is the one that must force the subscription session.
    expect(codexEnv.ANTHROPIC_API_KEY).toBe('ant-x')
    const claudeEnv = buildAgentEnv('claude', { ANTHROPIC_API_KEY: 'ant-x' }, hostEnv)
    expect(claudeEnv.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
