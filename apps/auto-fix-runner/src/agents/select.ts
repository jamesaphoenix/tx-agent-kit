import {
  DEFAULT_AUTO_FIX_AGENT,
  autoFixAgentKinds,
  type AutoFixAgentKind
} from '@tx-agent-kit/contracts'
import type { CodexAuthInspectionEnv } from './auth.js'
import { createClaudeRunner } from './claude-runner.js'
import { createCodexRunner } from './codex-runner.js'
import type { AgentRunner } from './types.js'

const isAutoFixAgentKind = (value: string): value is AutoFixAgentKind =>
  (autoFixAgentKinds as ReadonlyArray<string>).includes(value)

/**
 * Resolve which agent kind to run from a raw `AUTO_FIX_AGENT` value.
 *
 * Defaults to `DEFAULT_AUTO_FIX_AGENT` ('codex') when unset/blank. An explicit
 * but unrecognised value throws so a typo in the env never silently routes to
 * the wrong runtime.
 */
export const resolveAgentKind = (raw: string | undefined): AutoFixAgentKind => {
  const normalized = (raw ?? '').trim().toLowerCase()
  if (normalized.length === 0) {
    return DEFAULT_AUTO_FIX_AGENT
  }
  if (isAutoFixAgentKind(normalized)) {
    return normalized
  }
  throw new Error(
    `Invalid AUTO_FIX_AGENT '${raw ?? ''}'. Expected one of: ${autoFixAgentKinds.join(', ')}`
  )
}

export interface SelectAgentRunnerInput {
  /** Raw AUTO_FIX_AGENT value (resolved to a kind here; defaults to codex). */
  readonly agent: string | undefined
  /** Codex OAuth inspection signals, read by the caller from the env module. */
  readonly codexAuthEnv: CodexAuthInspectionEnv
  /** Child env for the Claude auth check (host snapshot, API keys stripped). */
  readonly claudeAuthCheckEnv: Record<string, string>
}

/**
 * Select the pluggable agent runner. The caller reads every env signal through
 * the dedicated env module (never host env here) and passes them in; we
 * resolve the kind (defaulting to codex) and build the matching CLI-backed
 * runner with its auth env closed over. No host environment is read here.
 */
export const selectAgentRunner = (input: SelectAgentRunnerInput): AgentRunner => {
  const kind = resolveAgentKind(input.agent)
  return kind === 'claude'
    ? createClaudeRunner(input.claudeAuthCheckEnv)
    : createCodexRunner(input.codexAuthEnv)
}
