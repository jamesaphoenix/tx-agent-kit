#!/usr/bin/env bash
set -euo pipefail

# Shared slot resolution for self-hosted Mac Studio runners.
#
# Up to four runners share one Mac Studio, alongside sibling repos whose CI
# jobs land on the SAME four runners. Each runner owns a "slot" (0-3) that keys
# every isolation dimension the test harness already understands:
#   - WORKTREE_PORT_OFFSET  = slot * 2000  (ports: 4100+o integration api,
#     4300+o fake OpenRouter sidecar, 4401..4431+o web-integration slots
#     (stride 10), 4121+o testkit-auth, 3510+o e2e web, 4510+o e2e api)
#   - DATABASE_SCHEMA       = wt_ci_txak_slot<N>  (the wt_ prefix is protected
#     from the leaked-schema GC in scripts/test/gc-test-schemas.sql; the txak_
#     infix keeps it disjoint from the sibling repos' CI-slot schemas in the
#     shared Postgres, which carry their own project infixes)
#   - Temporal task queues, Redis namespaces, and API/worker lockfiles all
#     derive from the offset via scripts/test/vitest-global-setup.ts.
#
# The 2000 stride keeps slots disjoint from local worktree offsets (100-1099)
# and exceeds the 1000-port gap between the e2e web (3510) and api (4510)
# bases. Derived ports were checked against every long-lived listener on the
# Studio (5000/7000 AirPlay, 7233 Temporal, 8123/8233/8888/8969/9000-9100
# infra, 13133 OTEL health, 16686 Jaeger, 3001 Grafana, 3100 Loki, 5432
# Postgres, 6379 Redis, 9090 Prometheus) - no slot lands on any of them.
# Note the current e2e web base 3000 would put slot 1/2 on the Studio's
# AirPlay ports (5000/7000), so the e2e slot mode uses the 3510/4510 bases
# instead (see resolve-runner-slot.sh).
#
# Cross-repo isolation is by SCHEMA and Temporal QUEUE prefix, not by port: a
# runner runs one job at a time and each runner owns one slot, so two jobs
# (this repo or a sibling) can never share a port band regardless of repo. The
# schema/queue prefixes matter because Postgres and the Temporal dev server
# PERSIST state across the sequential jobs sharing a slot.
#
# Slot source of truth: TX_RUNNER_SLOT in the runner's .env file. Fallback
# convention: runner name "mac-studio-runner" -> slot 0, "mac-studio-runner-N"
# -> slot N-1. Any other runner must set TX_RUNNER_SLOT explicitly; failing
# loudly here beats two runners silently sharing slot 0.

resolve_runner_slot() {
  local slot="${TX_RUNNER_SLOT:-}"

  if [[ -z "$slot" ]]; then
    local runner_name="${RUNNER_NAME:-}"
    if [[ "$runner_name" == "mac-studio-runner" ]]; then
      slot=0
    elif [[ "$runner_name" =~ ^mac-studio-runner-([0-9]+)$ ]]; then
      slot=$((BASH_REMATCH[1] - 1))
    else
      echo "Cannot resolve a runner slot: TX_RUNNER_SLOT is unset and RUNNER_NAME='${runner_name}' does not match mac-studio-runner[-N]." >&2
      echo "Set TX_RUNNER_SLOT=<0-3> in the runner's .env file (next to .runner) and restart the runner service." >&2
      return 1
    fi
  fi

  if ! [[ "$slot" =~ ^[0-3]$ ]]; then
    echo "Runner slot '$slot' is out of range 0-3. Four slots are provisioned; adding a fifth runner needs a new port-map review in runner-slot-lib.sh." >&2
    return 1
  fi

  printf '%s\n' "$slot"
}

runner_slot_offset() {
  local slot="$1"
  printf '%s\n' "$((slot * 2000))"
}

runner_slot_schema() {
  local slot="$1"
  printf 'wt_ci_txak_slot%s\n' "$slot"
}
