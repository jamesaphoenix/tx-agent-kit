#!/usr/bin/env bash
# Post-job cleanup for a runner slot: kill orphaned test processes so the next
# job on this runner starts from a quiet slate. Budget-killed vitest runs leave
# orphans behind, and a shared host with prod/staging containers cannot afford
# leaked CPU burners.
#
# Scope is strictly this runner's slot:
#   - listeners on the slot's derived port set (integration api, web-slot
#     apis, fake sidecar, testkit-auth, e2e web/api)
#   - vitest/tsx processes whose command line points into THIS runner's
#     workspace (each runner has a distinct _work path, so this can never
#     touch a sibling runner's processes)
#
# Best-effort by design: this must never fail a job (every kill is
# failure-proofed), and leaked per-suite schemas are already
# garbage-collected by scripts/test/reset-test-db.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/runner-slot-lib.sh"

SLOT="$(resolve_runner_slot)" || exit 0
OFFSET="$(runner_slot_offset "$SLOT")"

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Killing listeners on port ${port}: ${pids//$'\n'/ }"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

# Integration shared api (4100+o), web-integration api slots (4401..4431+o,
# stride 10 - sweep the whole band), testkit-auth (4121+o), fake OpenRouter
# sidecar (4300+o), and the e2e web/api (3510/4510+o).
for port_base in 4100 4121 4300 4401 4411 4421 4431 3510 4510; do
  kill_port_listeners "$((port_base + OFFSET))"
done

# Orphaned vitest/tsx workers under this runner's workspace. GITHUB_WORKSPACE
# is unique per runner (_work vs _work2 ...), so the match cannot cross slots.
if [[ -n "${GITHUB_WORKSPACE:-}" ]]; then
  orphans="$(pgrep -f "vitest.*${GITHUB_WORKSPACE}|${GITHUB_WORKSPACE}.*vitest" 2>/dev/null || true)"
  if [[ -n "$orphans" ]]; then
    echo "Killing orphaned vitest processes: ${orphans//$'\n'/ }"
    # shellcheck disable=SC2086
    kill -9 $orphans 2>/dev/null || true
  fi
fi

echo "Slot ${SLOT} cleanup complete."
exit 0
