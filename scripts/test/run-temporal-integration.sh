#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

TEMPORAL_RUNTIME_MODE="${TEMPORAL_RUNTIME_MODE:-cli}"

require_env_var() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: ${key}"
    exit 1
  fi
}

echo "Ensuring Docker-backed infrastructure for Temporal integration tests..."
pnpm infra:ensure

if [[ "$TEMPORAL_RUNTIME_MODE" == "cli" ]]; then
  echo "Ensuring local Temporal CLI server is running..."
  pnpm temporal:dev:up
elif [[ "$TEMPORAL_RUNTIME_MODE" == "cloud" ]]; then
  require_env_var "TEMPORAL_ADDRESS"
  require_env_var "TEMPORAL_NAMESPACE"
  require_env_var "TEMPORAL_API_KEY"
  export TEMPORAL_TLS_ENABLED="${TEMPORAL_TLS_ENABLED:-true}"
else
  echo "Unsupported TEMPORAL_RUNTIME_MODE: ${TEMPORAL_RUNTIME_MODE} (expected 'cli' or 'cloud')."
  exit 1
fi

echo "Resetting DB state for deterministic Temporal integration execution..."
pnpm db:test:reset

echo "Running worker Temporal integration suite..."
if [[ "$#" -gt 0 ]]; then
  pnpm --filter @tx-agent-kit/worker test:integration:temporal -- "$@"
else
  pnpm --filter @tx-agent-kit/worker test:integration:temporal
fi
