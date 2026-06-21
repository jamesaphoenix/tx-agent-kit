import { describe, expect, it } from 'vitest'
import { resolveAgentKind, selectAgentRunner } from './select.js'

describe('resolveAgentKind', () => {
  it('defaults to codex when AUTO_FIX_AGENT is unset', () => {
    expect(resolveAgentKind(undefined)).toBe('codex')
  })

  it('defaults to codex when AUTO_FIX_AGENT is blank', () => {
    expect(resolveAgentKind('   ')).toBe('codex')
  })

  it('honours AUTO_FIX_AGENT=claude', () => {
    expect(resolveAgentKind('claude')).toBe('claude')
  })

  it('is case-insensitive', () => {
    expect(resolveAgentKind('Codex')).toBe('codex')
    expect(resolveAgentKind('CLAUDE')).toBe('claude')
  })

  it('throws on an unrecognised value rather than silently defaulting', () => {
    expect(() => resolveAgentKind('gemini')).toThrow(/Invalid AUTO_FIX_AGENT/)
  })
})

const codexAuthEnv = { codexHome: '/Users/test/.codex', hasOpenAiApiKey: false, hasCodexApiKey: false }
const claudeAuthCheckEnv = { HOME: '/Users/test', PATH: '/usr/bin' }

describe('selectAgentRunner', () => {
  it('returns the codex runner by default', () => {
    expect(
      selectAgentRunner({ agent: undefined, codexAuthEnv, claudeAuthCheckEnv }).kind
    ).toBe('codex')
  })

  it('returns the claude runner when AUTO_FIX_AGENT=claude', () => {
    expect(
      selectAgentRunner({ agent: 'claude', codexAuthEnv, claudeAuthCheckEnv }).kind
    ).toBe('claude')
  })
})
