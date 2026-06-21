import type { AutoFixAgentKind } from '@tx-agent-kit/contracts'

/**
 * Host environment keys that are safe to forward to a spawned agent CLI:
 * terminal + locale + XDG + home/path/shell, plus CODEX_HOME so the codex CLI
 * resolves its OAuth `auth.json`. Anything not on this list is dropped before
 * we merge in the rendered staging/prod secrets.
 *
 * The actual host-env snapshot is taken in the dedicated env module
 * (`config/env.ts#readHostAgentEnv`) and passed in here, so this file never
 * reads host environment variables directly.
 */
export const allowedHostKeys = [
  'CODEX_HOME',
  'COLORTERM',
  'HOME',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME'
] as const

/**
 * Build the child-process environment for a headless agent run.
 *
 * 1. Start from the allowlisted host vars (`hostEnv`, already filtered to the
 *    forwardable terminal/locale/home/path + CODEX_HOME keys).
 * 2. Merge in `renderedEnv` — the pre-rendered staging|prod deploy secrets
 *    so the agent's repro commands see real creds (the accepted blast radius).
 * 3. ALWAYS strip `OPENAI_API_KEY` + `CODEX_API_KEY` so codex can never silently
 *    fall back to API-key billing instead of ChatGPT OAuth.
 * 4. For the claude runtime also strip `ANTHROPIC_API_KEY` so the CLI is forced
 *    onto the logged-in subscription session rather than API-key billing.
 *
 * `renderedEnv` is applied AFTER the host vars so a secret can override a
 * forwarded host value, but the API-key deletions run LAST so a rendered secret
 * can never reintroduce an API key.
 */
export const buildAgentEnv = (
  kind: AutoFixAgentKind,
  renderedEnv: Record<string, string>,
  hostEnv: Record<string, string>
): Record<string, string> => {
  const env: Record<string, string> = { ...hostEnv }

  for (const [key, value] of Object.entries(renderedEnv)) {
    env[key] = value
  }

  delete env.OPENAI_API_KEY
  delete env.CODEX_API_KEY
  if (kind === 'claude') {
    delete env.ANTHROPIC_API_KEY
  }

  return env
}
