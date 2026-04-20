# Agent test-budget hooks

Block agents (Claude Code, Codex, anything else that drives Bash through a
`PreToolUse` hook layer) from bumping `INTEGRATION_TIMEOUT_SECONDS=` to
silence slow integration tests.

The harness budgets integration tests at **120 seconds locally** (300 in CI).
Bumping the budget hides the actual problem — slow tests that should be
refactored. Each individual integration test should land under ~5s and the
full suite should land under ~90s wall-clock.

The hook is enforced at the agent layer (per-tool, before execution) so a
careless `INTEGRATION_TIMEOUT_SECONDS=180 pnpm test:integration:quiet` is
rejected with a stderr message instead of silently extending the deadline.

**There is NO escape hatch.** The only way to make a slow run fit the
budget is to refactor the slow tests so the suite fits inside it. If you
need to debug a hang in a single file, use `pnpm vitest run <path>`
directly — that bypasses the harness budget without touching this gate.

## Shared shell script

Both Claude Code and Codex use the **same** PreToolUse JSON envelope
(`hookSpecificOutput.permissionDecision: "deny"` with a
`permissionDecisionReason`). Both wire the same shell script, so the
rejection logic only lives in one place:

```
.claude/hooks/block-integration-timeout-bump.sh
```

The script reads JSON from stdin, extracts `tool_input.command`, greps it
for `INTEGRATION_TIMEOUT_SECONDS=` at a word boundary, and emits the deny
envelope on a match.

## Claude Code wiring

Already enabled in this repo via `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/block-raw-git-worktree-add.sh"
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/block-integration-timeout-bump.sh"
          }
        ]
      }
    ]
  }
}
```

Claude Code resolves `$CLAUDE_PROJECT_DIR` to the worktree root, so the
script path works in every checkout without modification.

## Codex wiring

Already enabled in this repo via `.codex/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/hooks/block-integration-timeout-bump.sh",
            "statusMessage": "Checking command for INTEGRATION_TIMEOUT_SECONDS bypass"
          }
        ]
      }
    ]
  }
}
```

Codex hooks live at `~/.codex/hooks.json` (user-level) or
`<repo>/.codex/hooks.json` (project-level). The project-level config in
this repo applies whenever Codex runs from the worktree root. Codex
resolves the relative `./` path against the cwd Codex was launched in.

> Reference: <https://developers.openai.com/codex/hooks>

## Manual smoke tests

```bash
# Negative — passes through.
echo '{"tool_name":"Bash","tool_input":{"command":"pnpm test:integration:quiet api"}}' \
  | bash .claude/hooks/block-integration-timeout-bump.sh

# Positive — rejected with the long error message.
echo '{"tool_name":"Bash","tool_input":{"command":"INTEGRATION_TIMEOUT_SECONDS=180 pnpm test"}}' \
  | bash .claude/hooks/block-integration-timeout-bump.sh

# Positive — also rejected even when the env var sits mid-command.
echo '{"tool_name":"Bash","tool_input":{"command":"CI=true INTEGRATION_TIMEOUT_SECONDS=300 ./scripts/test-integration-quiet.sh"}}' \
  | bash .claude/hooks/block-integration-timeout-bump.sh
```

All three should exit `0` — the JSON `permissionDecision` field carries
the allow/deny verdict to the agent, not the shell exit code.

## Why this matters

Two things are true at once:

1. The harness runner already prints `Slow tests detected: SLOW (Xms): test name` on
   every run, so the offenders are already named.
2. Agents under autonomous loops have no incentive to fix slow tests on
   their own — the path of least resistance is "bump the env var until the
   thing passes." That's how a 60s test suite turns into a 300s test
   suite turns into a flake-tolerant `--retry 3` test suite over a
   quarter.

The hook closes the easy escape and forces the agent to read the slow-test
output and act on it. Strict mode (no opt-out) is intentional: every agent
that hits this gate must do the actual refactor work, not the easy
sidestep.

## Adding a new agent

If you wire up another autonomous agent (Cursor, Aider, Continue, or your
own MCP-driven loop) and it has its own pre-command hook system:

1. Point its hook at the same `.claude/hooks/block-integration-timeout-bump.sh`
   script. The deny-envelope JSON is the de-facto standard for both
   Claude Code and Codex; if your agent uses a different envelope shape,
   write a thin shim in your hook config that translates it.
2. If the agent doesn't support hooks, document the constraint in its
   project README so humans review its commands. There's no enforcement
   layer left if the agent can't be intercepted.
