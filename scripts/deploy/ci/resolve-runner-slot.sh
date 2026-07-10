#!/usr/bin/env bash
# Export this runner's slot-scoped environment to $GITHUB_ENV so concurrent
# jobs on the shared Mac Studio (this repo AND its sibling repos) never collide
# on ports, Postgres schemas, Redis namespaces, or Temporal task queues. See
# runner-slot-lib.sh for the slot model and port map.
#
# Usage: resolve-runner-slot.sh [integration|e2e]
#
# integration: the vitest harness derives its ports from WORKTREE_PORT_OFFSET
#   (scripts/test/vitest-global-setup.ts) and spawns the shared API on
#   4100+offset, so only the offset, schema, DATABASE_URL, API_PORT, and the
#   OAuth callback URL (which the harness does NOT pin) are emitted here.
# e2e: the api/web servers read their config straight from process env, so the
#   full port-bearing URL set is emitted at the slot's e2e ports.
#
# The values are written via GITHUB_ENV (not workflow YAML env) on purpose:
# they depend on which runner picked up the job, which YAML cannot express.
# The workflow env must NOT re-declare any of these keys - a YAML-level value
# would shadow what is emitted here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/runner-slot-lib.sh"

MODE="${1:-integration}"
case "$MODE" in
  integration|e2e) ;;
  *)
    echo "Usage: $0 [integration|e2e]" >&2
    exit 1
    ;;
esac

if [[ -z "${GITHUB_ENV:-}" ]]; then
  echo "GITHUB_ENV is not set; this script only runs inside GitHub Actions." >&2
  exit 1
fi

SLOT="$(resolve_runner_slot)"
OFFSET="$(runner_slot_offset "$SLOT")"
SCHEMA="$(runner_slot_schema "$SLOT")"

# Same search_path binding scripts/worktree/setup.sh writes for worktrees: the
# runtime api/worker only scope to the schema through the connection string.
DATABASE_URL="postgres://postgres:postgres@localhost:5432/tx_agent_kit?options=-c%20search_path%3D${SCHEMA},public"

emit() {
  printf '%s=%s\n' "$1" "$2" >>"$GITHUB_ENV"
}

emit TX_RUNNER_SLOT "$SLOT"
emit WORKTREE_PORT_OFFSET "$OFFSET"
emit DATABASE_SCHEMA "$SCHEMA"
emit DATABASE_URL "$DATABASE_URL"
# Temporal task queues share ONE dev server across the sibling repos, so the
# txak- prefix keeps them disjoint from the other repos' CI-slot queues.
emit TEMPORAL_TASK_QUEUE "txak-ci-slot${SLOT}"
emit EMAIL_CAMPAIGNS_TASK_QUEUE "txak-email-campaigns-ci-slot${SLOT}"

if [[ "$MODE" == "integration" ]]; then
  API_PORT=$((4100 + OFFSET))
  emit API_PORT "$API_PORT"
  # Port-free semantics preserved from the pre-slot workflow env: no web
  # server runs in the integration job, these are link/CORS config strings.
  # (The spawned shared API also hardcodes API_CORS_ORIGIN=http://localhost:3000.)
  emit WEB_BASE_URL "http://localhost:3000"
  emit API_CORS_ORIGIN "http://localhost:3000"
  # The vitest harness spawns the API on 4100+offset but does NOT pin the
  # OAuth callback URL, so pin it to the slot's API port here (the api env
  # schema requires the Google OIDC group to be configured together).
  emit GOOGLE_OIDC_CALLBACK_URL "http://localhost:${API_PORT}/v1/auth/google/callback"
  # pgTAP gets a DEDICATED per-slot schema with a full rebuild, never the
  # slot's app schema: run-pgtap.sh builds its target by replaying the raw
  # migration .sql files from scratch, and replaying them over an
  # already-drizzle-migrated schema is not idempotent (early migrations
  # reference columns that later migrations renamed). The name has no uuid hex
  # tail, so the leaked-schema GC can never select it.
  emit PGTAP_SCHEMA "pgtap_txak_slot${SLOT}"
  emit PGTAP_REBUILD_SCHEMA "true"
else
  # e2e web base 3510 / api base 4510 (NOT the pre-slot 3000/4100): with the
  # 2000 stride, a 3000 web base would put slot 1/2 on the Studio's AirPlay
  # ports (5000/7000). 3510/4510 keep all four slots clear.
  WEB_PORT=$((3510 + OFFSET))
  API_PORT=$((4510 + OFFSET))
  WEB_URL="http://localhost:${WEB_PORT}"
  API_URL="http://localhost:${API_PORT}"
  emit WEB_PORT "$WEB_PORT"
  emit API_PORT "$API_PORT"
  emit NEXT_PUBLIC_API_BASE_URL "$API_URL"
  emit API_CORS_ORIGIN "$WEB_URL"
  emit WEB_BASE_URL "$WEB_URL"
  emit GOOGLE_OIDC_CALLBACK_URL "${API_URL}/v1/auth/google/callback"
fi

echo "Resolved runner slot ${SLOT} (runner '${RUNNER_NAME:-unknown}', mode ${MODE}): offset=${OFFSET} schema=${SCHEMA} api_port=${API_PORT}"
