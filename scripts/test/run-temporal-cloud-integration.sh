#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

if [[ "${RUN_TEMPORAL_CLOUD_INTEGRATION:-0}" != "1" ]]; then
  echo "Skipping Temporal Cloud integration tests."
  echo "Set RUN_TEMPORAL_CLOUD_INTEGRATION=1 to run against Temporal Cloud."
  exit 0
fi

if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

TEMPORAL_CLOUD_ADDRESS="${TEMPORAL_CLOUD_TEST_ADDRESS:-${TEMPORAL_ADDRESS:-}}"
TEMPORAL_CLOUD_NAMESPACE="${TEMPORAL_CLOUD_TEST_NAMESPACE:-${TEMPORAL_NAMESPACE:-}}"
TEMPORAL_CLOUD_API_KEY="${TEMPORAL_CLOUD_TEST_API_KEY:-${TEMPORAL_API_KEY:-}}"

if [[ -z "$TEMPORAL_CLOUD_ADDRESS" || -z "$TEMPORAL_CLOUD_NAMESPACE" || -z "$TEMPORAL_CLOUD_API_KEY" ]]; then
  echo "Missing Temporal Cloud test credentials."
  echo "Set TEMPORAL_CLOUD_TEST_ADDRESS, TEMPORAL_CLOUD_TEST_NAMESPACE, and TEMPORAL_CLOUD_TEST_API_KEY"
  echo "or provide TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, and TEMPORAL_API_KEY."
  exit 1
fi

export TEMPORAL_RUNTIME_MODE="cloud"
export TEMPORAL_ADDRESS="$TEMPORAL_CLOUD_ADDRESS"
export TEMPORAL_NAMESPACE="$TEMPORAL_CLOUD_NAMESPACE"
export TEMPORAL_API_KEY="$TEMPORAL_CLOUD_API_KEY"
export TEMPORAL_TLS_ENABLED="${TEMPORAL_TLS_ENABLED:-true}"

echo "Running Temporal Cloud integration tests against ${TEMPORAL_ADDRESS} namespace ${TEMPORAL_NAMESPACE}..."
exec "$SCRIPT_DIR/run-temporal-integration.sh" "$@"
