import { DEFAULT_AUTO_FIX_AGENT, type AutoFixAgentKind } from '@tx-agent-kit/contracts'
import type { CodexAuthInspectionEnv } from '../agents/auth.js'
import { allowedHostKeys, buildAgentEnv } from '../agents/env.js'
import { resolveAgentKind } from '../agents/select.js'

const defaultTemporalAddress = 'localhost:7233'
const defaultTemporalNamespace = 'default'
const defaultBaseBranch = 'main'

/**
 * Runtime configuration for the host auto-fix Temporal worker.
 *
 * `process.env` is read ONLY here (the dedicated env module) so the rest of the
 * package never touches it directly. The Temporal connection mirrors the
 * `apps/worker` cli/cloud convention; the auto-fix knobs (enabled kill switch,
 * agent selection, model, base branch) are specific to this runner.
 */
export interface AutoFixRunnerEnv {
  readonly NODE_ENV: string
  readonly DATABASE_URL: string
  readonly REDIS_URL: string | undefined
  readonly TEMPORAL_ADDRESS: string
  readonly TEMPORAL_NAMESPACE: string
  readonly TEMPORAL_API_KEY: string | undefined
  readonly TEMPORAL_TLS_ENABLED: boolean
  /** Master kill switch — when false the activity returns `skipped` immediately. */
  readonly AUTO_FIX_ENABLED: boolean
  /** Selected agent runtime ('codex' | 'claude'); defaults to codex. */
  readonly AUTO_FIX_AGENT: AutoFixAgentKind
  /**
   * Optional model id to pin for the agent run. When unset, the agent CLI picks
   * its own default/recommended model, so the runner tracks the recommended
   * model over time instead of a hardcoded slug.
   */
  readonly AGENT_MODEL: string | undefined
  /**
   * The branch the agent's fix branches off and the draft PR targets. Defaults
   * to `main`; set to `staging` (or any integration branch) per deployment. The
   * host worker fetches `origin/<base>` fresh and branches the worktree off it.
   */
  readonly AUTO_FIX_BASE_BRANCH: string
  /**
   * Directory holding the PRE-RENDERED per-environment deploy env files
   * (`staging.env`, `prod.env`) the activity reads to give the agent live
   * creds. Reuses the deploy cache pattern so the host worker never runs
   * `op inject` — `op` is unreliable non-interactively (the same reason deploys
   * render from a cached file).
   */
  readonly AUTO_FIX_RESOLVED_ENV_DIR: string
  /**
   * Sentry API token for the issue comment-back, resolved into the worker env
   * (NOT read via `op` on the host). Optional: a missing token makes the
   * comment a non-fatal no-op.
   */
  readonly SENTRY_AUTH_TOKEN: string | undefined
  /**
   * Sentry organization slug for the org-scoped comments endpoint
   * (`/api/0/organizations/<slug>/issues/<id>/comments/`); the unscoped issue
   * endpoints 404. Defaults to empty: with no slug the comment-back is a no-op.
   */
  readonly SENTRY_ORG_SLUG: string
  /**
   * Optional override (ms) for the agent's wall-clock budget. Defaults to 25
   * minutes so a codex hang fails fast instead of blocking the single-flight
   * queue for hours; an override is clamped to the activity timeout minus a
   * finalize buffer. An operational knob (tune per host / lengthen for a big
   * fix); must stay below the Temporal activity `startToCloseTimeout` or the
   * activity is abandoned before finalize.
   */
  readonly AGENT_TIMEOUT_MS: number | undefined
}

const parseOptionalStringEnv = (value: string | undefined): string | undefined => {
  if (typeof value === 'undefined') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const parseOptionalNumberEnv = (value: string | undefined): number | undefined => {
  const trimmed = parseOptionalStringEnv(value)
  if (typeof trimmed === 'undefined') {
    return undefined
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive-number value '${trimmed}'`)
  }
  return parsed
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (typeof value === 'undefined') {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false
  }
  throw new Error(`Invalid boolean value '${value}'`)
}

let cached: AutoFixRunnerEnv | null = null

export const resetAutoFixRunnerEnvCache = (): void => {
  cached = null
}

export const getAutoFixRunnerEnv = (): AutoFixRunnerEnv => {
  if (cached) {
    return cached
  }

  const databaseUrl = parseOptionalStringEnv(process.env.DATABASE_URL)
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the auto-fix runner to persist run results')
  }

  cached = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    DATABASE_URL: databaseUrl,
    REDIS_URL: parseOptionalStringEnv(process.env.REDIS_URL),
    TEMPORAL_ADDRESS: parseOptionalStringEnv(process.env.TEMPORAL_ADDRESS) ?? defaultTemporalAddress,
    TEMPORAL_NAMESPACE:
      parseOptionalStringEnv(process.env.TEMPORAL_NAMESPACE) ?? defaultTemporalNamespace,
    TEMPORAL_API_KEY: parseOptionalStringEnv(process.env.TEMPORAL_API_KEY),
    TEMPORAL_TLS_ENABLED: parseBooleanEnv(process.env.TEMPORAL_TLS_ENABLED, false),
    AUTO_FIX_ENABLED: parseBooleanEnv(process.env.AUTO_FIX_ENABLED, false),
    AUTO_FIX_AGENT: resolveAgentKind(process.env.AUTO_FIX_AGENT),
    AGENT_MODEL: parseOptionalStringEnv(process.env.AGENT_MODEL),
    AUTO_FIX_BASE_BRANCH:
      parseOptionalStringEnv(process.env.AUTO_FIX_BASE_BRANCH) ?? defaultBaseBranch,
    AUTO_FIX_RESOLVED_ENV_DIR:
      parseOptionalStringEnv(process.env.AUTO_FIX_RESOLVED_ENV_DIR) ??
      `${process.env.HOME ?? '.'}/.local/state/tx-agent-kit/deploy`,
    SENTRY_AUTH_TOKEN: parseOptionalStringEnv(process.env.SENTRY_AUTH_TOKEN),
    SENTRY_ORG_SLUG: parseOptionalStringEnv(process.env.SENTRY_ORG_SLUG) ?? '',
    AGENT_TIMEOUT_MS: parseOptionalNumberEnv(process.env.AGENT_TIMEOUT_MS)
  }
  return cached
}

/**
 * Snapshot the forwardable host environment for a spawned agent CLI: just the
 * allowlisted terminal/locale/home/path + CODEX_HOME keys. This is the only
 * place the runner reads host `process.env` keys for the child env; the actual
 * merge + API-key stripping happens in `buildAgentEnv`.
 */
export const readHostAgentEnv = (): Record<string, string> => {
  const host: Record<string, string> = {}
  for (const key of allowedHostKeys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) {
      host[key] = value
    }
  }
  return host
}

/**
 * Capture the host signals needed to inspect Codex OAuth health (CODEX_HOME +
 * whether an API-key env var is present). Read here, in the dedicated env
 * module, so `agents/auth.ts` never touches host environment variables.
 */
export const readCodexAuthEnv = (): CodexAuthInspectionEnv => ({
  codexHome: process.env.CODEX_HOME ?? '',
  hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
  hasCodexApiKey: Boolean(process.env.CODEX_API_KEY)
})

/**
 * Build the child env used by the Claude auth check: the forwardable host
 * snapshot with API keys stripped (ANTHROPIC_API_KEY removed) so a
 * subscription session is what gets verified, never an API key.
 */
export const readClaudeAuthCheckEnv = (): Record<string, string> =>
  buildAgentEnv('claude', {}, readHostAgentEnv())

/**
 * Local Postgres URL forced for the worktree setup script. `scripts/worktree`
 * tooling (`lib/validation.sh`) rejects any non-local `DATABASE_URL` so dev
 * tooling can never run against a real DB. The host worker process carries the
 * REAL staging/prod `DATABASE_URL` (to update `auto_fix_runs`) and the agent
 * gets live creds via the rendered env — but `create.sh`'s child must see a
 * LOCAL url or setup fails. Matches setup.sh's own local fallback.
 */
const LOCAL_WORKTREE_TOOLING_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/tx_agent_kit'

/**
 * The inherited host env with `DATABASE_URL` forced to the local tooling URL,
 * used only for spawning `scripts/worktree/create.sh`. Keeps everything else
 * (PATH, HOME, SSH/credential sockets needed for `git fetch`) intact. Built in
 * this env module so `process.env` stays read here only.
 */
export const buildWorktreeToolingEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  DATABASE_URL: LOCAL_WORKTREE_TOOLING_DATABASE_URL,
  // Skip the dev infra bring-up (infra:ensure / temporal / schema / seed) in the
  // worktree setup: the host worker must not spin the full observability stack
  // per run (it hangs on container health + collides with deploy ports). The
  // checkout + ports + seeded .env + installed deps are enough for the agent.
  WORKTREE_SKIP_INFRA: '1'
})

export { DEFAULT_AUTO_FIX_AGENT }
