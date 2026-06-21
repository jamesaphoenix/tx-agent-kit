import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { AgentAuthCheck } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Host signals needed to inspect Codex OAuth health, captured by the dedicated
 * env module so this file never reads host environment variables directly.
 * `codexHome` is already resolved (falling back to ~/.codex); the two boolean
 * flags record whether an API-key env var is present (which we refuse).
 */
export interface CodexAuthInspectionEnv {
  readonly codexHome: string
  readonly hasOpenAiApiKey: boolean
  readonly hasCodexApiKey: boolean
}

/**
 * Inspect Codex OAuth health before a run.
 *
 * Read `<codexHome>/auth.json`, require `auth_mode === 'chatgpt'` with both
 * OAuth tokens present, and refuse if a stored API key is present (so the worker
 * can never silently bill an API key). Returns the list of blockers — the
 * activity aborts with status `blocked` if any are found. We do NOT read or echo
 * any token value; only presence is checked.
 */
export const inspectCodexAuth = (authEnv: CodexAuthInspectionEnv): Promise<AgentAuthCheck> => {
  const blockers: string[] = []
  const codexHome = authEnv.codexHome.length > 0 ? authEnv.codexHome : resolve(homedir(), '.codex')
  const authFile = resolve(codexHome, 'auth.json')

  if (authEnv.hasOpenAiApiKey) {
    blockers.push('OPENAI_API_KEY is present in the host env; refusing API-key fallback.')
  }
  if (authEnv.hasCodexApiKey) {
    blockers.push('CODEX_API_KEY is present in the host env; refusing API-key fallback.')
  }

  if (!existsSync(authFile)) {
    blockers.push('Codex auth file is missing; run `codex login` and choose ChatGPT OAuth.')
    return Promise.resolve({ status: 'blocked', blockers })
  }

  try {
    const auth = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, unknown>
    const tokens = isRecord(auth.tokens) ? auth.tokens : {}
    const authMode = typeof auth.auth_mode === 'string' ? auth.auth_mode : null
    const hasTokens =
      typeof tokens.access_token === 'string' && typeof tokens.refresh_token === 'string'

    if (authMode !== 'chatgpt') {
      blockers.push(`Codex stored auth_mode is ${authMode ?? 'missing'}, not chatgpt.`)
    }
    if (!hasTokens) {
      blockers.push('Codex ChatGPT OAuth access/refresh tokens were not detected.')
    }
    if (auth.OPENAI_API_KEY) {
      blockers.push('Codex auth file contains a stored API key; refusing API-key generation.')
    }
  } catch (error) {
    blockers.push(`Codex auth file could not be inspected: ${errorMessage(error)}`)
  }

  return Promise.resolve(
    blockers.length > 0 ? { status: 'blocked', blockers } : { status: 'ok', blockers: [] }
  )
}

/**
 * Validate the Claude CLI has a usable logged-in subscription session by
 * spawning `claude auth status --json` and checking the authenticated flag.
 * The CLI is invoked with the provided child env (API keys already stripped by
 * the caller) so a session-only login is what gets verified, never an API key.
 */
export const validateClaudeAuth = (childEnv: Record<string, string>): Promise<AgentAuthCheck> => {
  const blockers: string[] = []

  try {
    const result = spawnSync('claude', ['auth', 'status', '--json'], {
      encoding: 'utf8',
      env: childEnv
    })
    if (result.error) {
      blockers.push(`Claude auth check failed to spawn: ${errorMessage(result.error)}`)
      return Promise.resolve({ status: 'blocked', blockers })
    }
    if (result.status !== 0) {
      blockers.push(`Claude auth status exited with code ${result.status ?? 'null'}.`)
      return Promise.resolve({ status: 'blocked', blockers })
    }
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    if (parsed.authenticated !== true) {
      blockers.push('Claude CLI is not authenticated; run `claude login`.')
    }
  } catch (error) {
    blockers.push(`Claude auth check failed: ${errorMessage(error)}`)
  }

  return Promise.resolve(
    blockers.length > 0 ? { status: 'blocked', blockers } : { status: 'ok', blockers: [] }
  )
}
