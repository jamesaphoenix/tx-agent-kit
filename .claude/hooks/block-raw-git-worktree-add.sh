#!/usr/bin/env bash
# PreToolUse hook: block raw `git worktree add` so agents are forced through
# scripts/worktree/create.sh. That script runs port allocation, .env secret
# seeding from the primary checkout, and Postgres schema creation — skipping
# them leaves the worktree broken for `pnpm dev` and `pnpm test:integration`.
#
# Other `git worktree` subcommands (list, remove, prune, lock, unlock, move,
# repair) are allowed through unchanged.
#
# Escape hatch: set ALLOW_RAW_GIT_WORKTREE_ADD=1 in the environment of the
# hook invocation (or in shell state Claude Code will inherit) to bypass the
# block. Use sparingly — intended only for recovery from a broken state.

set -euo pipefail

emit_allow() {
  cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
JSON
}

emit_deny() {
  local reason="$1"
  # Use printf + jq to safely JSON-encode the reason string.
  local encoded_reason
  encoded_reason="$(printf '%s' "$reason" | jq -Rs .)"
  cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $encoded_reason
  }
}
JSON
}

# Read the tool invocation JSON from stdin.
payload="$(cat)"

# Extract the tool name and command. If jq can't parse, fail open (allow).
if ! tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"; then
  emit_allow
  exit 0
fi

if [[ "$tool_name" != "Bash" ]]; then
  emit_allow
  exit 0
fi

if ! command_str="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"; then
  emit_allow
  exit 0
fi

if [[ -z "$command_str" ]]; then
  emit_allow
  exit 0
fi

# Explicit opt-out for recovery scenarios.
if [[ "${ALLOW_RAW_GIT_WORKTREE_ADD:-}" == "1" ]]; then
  emit_allow
  exit 0
fi

# Match `git worktree add` at a command boundary (start of string, after `;`,
# after `&&`, after `|`, after a newline, etc.). We only block `add` — every
# other worktree subcommand (list, remove, prune, lock, unlock, move, repair)
# passes through.
#
# The regex allows arbitrary whitespace between `git`, `worktree`, and `add`,
# but anchors on word boundaries so a script or file path containing the
# literal text `git worktree add` in a comment or string doesn't trigger
# false positives on non-invocation commands. We still err on the side of
# safety: any Bash command that would actually execute `git worktree add`
# is caught.
if printf '%s' "$command_str" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+worktree[[:space:]]+add($|[[:space:]])'; then
  reason=$'Raw `git worktree add` is blocked in this repo.\n\nUse the sanctioned entry point instead:\n\n    ./scripts/worktree/create.sh <branch-name> [base-branch]\n\nIt creates the worktree from the primary checkout and then runs\nscripts/worktree/setup.sh against it so the new worktree has:\n  - a unique WORKTREE_PORT_OFFSET (so dev servers and integration tests\n    run in parallel across worktrees without port collisions),\n  - secrets seeded from the primary .env (R2, Sentry, Resend, etc.),\n  - a dedicated Postgres schema (DATABASE_URL already configured).\n\nExamples:\n    ./scripts/worktree/create.sh feat/tenancy-team-members\n    ./scripts/worktree/create.sh fix/billing-refund main\n\nIf you genuinely need the raw git command (recovery, rare edge case),\nset ALLOW_RAW_GIT_WORKTREE_ADD=1 in the environment and retry.'
  emit_deny "$reason"
  exit 0
fi

emit_allow
