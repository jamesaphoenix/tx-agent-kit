import type { AutoFixAgentKind, AutoFixResult } from '@tx-agent-kit/contracts'

/**
 * Result of a pre-run auth inspection. `blocked` means the agent CLI is not
 * usable (no OAuth/subscription session, or an API key is present that would
 * silently bill) and the activity should abort early with the listed blockers.
 */
export interface AgentAuthCheck {
  readonly status: 'ok' | 'blocked'
  readonly blockers: ReadonlyArray<string>
}

/**
 * Inputs for a single headless agent run. The same shape is consumed by both
 * the codex and claude runners so the activity is agent-agnostic.
 */
export interface AgentRunInput {
  /** Absolute path to the prepared per-issue worktree the agent runs inside. */
  readonly worktreePath: string
  /**
   * Optional model slug to pin for the run. When omitted, the agent CLI uses its
   * own default/recommended model.
   */
  readonly model?: string
  /** Fully-rendered operator prompt (error context + tooling + hard rules). */
  readonly prompt: string
  /** JSON-Schema object describing the AutoFixResult contract. */
  readonly outputSchema: object
  /**
   * Child-process env: the allowlisted host vars merged with the rendered
   * staging/prod secrets, with agent API keys stripped (see buildAgentEnv).
   */
  readonly env: Record<string, string>
  /** Hard wall-clock budget for the spawned CLI before it is killed. */
  readonly timeoutMs: number
}

/**
 * Normalized result returned by every AgentRunner. `structured` is the parsed +
 * validated AutoFixResult (or null when the agent emitted nothing parseable),
 * and `jsonl` is the raw stream captured verbatim for audit.
 */
export interface AgentRunResult {
  readonly agent: AutoFixAgentKind
  readonly structured: AutoFixResult | null
  readonly jsonl: string
  readonly items: ReadonlyArray<unknown>
  readonly exitCode: number | null
  readonly error?: string
  /**
   * The tail of the agent CLI's stderr (capped to bound memory). Codex emits its
   * diagnostic logs (RUST_LOG) here, so a hung/killed run records WHERE it
   * stalled even when no structured result is produced.
   */
  readonly stderrTail?: string
}

/**
 * Pluggable agent runtime. Two CLI-backed implementations exist (codex,
 * claude) selected by the AUTO_FIX_AGENT env var. Both spawn the official CLI
 * binary via node:child_process and return the same {@link AgentRunResult}.
 */
export interface AgentRunner {
  readonly kind: AutoFixAgentKind
  readonly inspectAuth: () => Promise<AgentAuthCheck>
  readonly run: (input: AgentRunInput) => Promise<AgentRunResult>
}
