#!/usr/bin/env bash
# PreToolUse hook: block any Bash command that overrides
# `INTEGRATION_TIMEOUT_SECONDS` in its env prefix.
#
# Background: the integration test harness defaults to a 120s wall-clock
# budget locally (and 300s in CI). Bumping the budget at the command line
# is a code smell: it hides slow tests by giving them more time instead of
# making them fast. Every test the suite accumulates this way moves the
# baseline up forever. The fix is always the SAME — find the slow tests
# the harness reports and refactor them, not silence the budget.
#
# What's blocked:
#   INTEGRATION_TIMEOUT_SECONDS=180 pnpm test:integration:quiet
#   INTEGRATION_TIMEOUT_SECONDS=300 ./scripts/test-integration-quiet.sh api
#   env INTEGRATION_TIMEOUT_SECONDS=600 vitest run
#
# What still works:
#   pnpm test:integration:quiet                                  (defaults)
#   pnpm test:integration:quiet api                              (defaults)
#   CI=true pnpm test:integration:full                           (CI mode)
#
# This hook is INTENTIONALLY strict — there is no escape hatch. The only
# way to "bump the budget" is to refactor the slow tests so the suite
# fits inside it. Diagnostic flows that genuinely need more time should
# isolate the suspect file via `pnpm vitest run <path>` (which doesn't
# go through the harness and isn't budgeted).

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

# If jq can't parse, fail open (allow).
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

# Match `INTEGRATION_TIMEOUT_SECONDS=` anywhere in the command. Word boundary
# on the left so e.g. `MY_INTEGRATION_TIMEOUT_SECONDS` doesn't false-match;
# `=` on the right so we only catch env-var prefix usage.
if printf '%s' "$command_str" | grep -qE '(^|[[:space:];&|])INTEGRATION_TIMEOUT_SECONDS='; then
  reason=$'INTEGRATION_TIMEOUT_SECONDS= override is BLOCKED.\n\nThe integration test suite MUST stay under the harness budget\n(120s locally, 300s in CI). The full suite SHOULD land under 90\nseconds wall-clock. Bumping the timeout is never the fix — it\nhides slow tests by giving them more rope and lets the suite\nbaseline drift up forever.\n\nThis hook has NO escape hatch. The only way to make a slow run\nfit the budget is to refactor the slow tests. Do the following:\n\n  1. Run `pnpm test:integration:quiet` with the default budget.\n  2. Read the "Slow tests detected" lines the runner prints on\n     timeout — every test over 10s is named there.\n  3. Open each offender and make it fast:\n     - replace wall-clock `sleep`/`waitFor` with event-driven\n       polling on a real signal (a DB row, a metric, a log line),\n     - share fixtures via `beforeAll` instead of recreating per\n       `it` block,\n     - drop per-test API-server boots (use the shared harness),\n     - inject the clock instead of waiting on real time,\n     - cut down N+1 setup queries to a single bulk insert,\n     - delete redundant integration coverage that a faster unit\n       test could give you.\n  4. Re-run. Each individual integration test should land under\n     ~5s; the full suite should land under ~90s wall-clock.\n\nIf you genuinely need to run a SINGLE slow file in isolation for\ndiagnosis, use `pnpm vitest run <path/to/file>` directly — that\nbypasses the harness budget without touching this gate.'
  emit_deny "$reason"
  exit 0
fi

emit_allow
