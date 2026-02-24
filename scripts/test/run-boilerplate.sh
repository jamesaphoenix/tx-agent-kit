#!/usr/bin/env bash
# Workspace-level boilerplate meta-test runner.
# Uses the integration global setup harness with a dedicated boilerplate workspace.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

ARGS=("$@")
if [[ "${ARGS[0]:-}" == "--" ]]; then
  ARGS=("${ARGS[@]:1}")
fi

PASSTHROUGH_ARGS=()
REQUEST_DRY_RUN="${BOILERPLATE_DRY_RUN:-}"

i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  arg="${ARGS[$i]}"

  if [[ "$arg" == "--dry-run" ]]; then
    REQUEST_DRY_RUN="1"
    i=$((i + 1))
    continue
  fi

  PASSTHROUGH_ARGS+=("$arg")
  i=$((i + 1))
done

if [[ -n "$REQUEST_DRY_RUN" ]]; then
  echo "Boilerplate runner dry-run summary:"
  echo "  BOILERPLATE_SKIP_INFRA_ENSURE=${BOILERPLATE_SKIP_INFRA_ENSURE:-0}"
  if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
    echo "  PASSTHROUGH_ARGS=${PASSTHROUGH_ARGS[*]}"
  else
    echo "  PASSTHROUGH_ARGS=(none)"
  fi
  exit 0
fi

if [[ "${BOILERPLATE_SKIP_INFRA_ENSURE:-0}" != "1" ]]; then
  echo "Ensuring boilerplate test infrastructure..."
  pnpm infra:ensure

  local_temporal_mode="${TEMPORAL_RUNTIME_MODE:-cli}"
  if [[ "$local_temporal_mode" == "cli" ]]; then
    echo "Ensuring local Temporal CLI runtime..."
    pnpm temporal:dev:up
  fi
else
  echo "Skipping infra ensure bootstrap (BOILERPLATE_SKIP_INFRA_ENSURE=1)."
  echo "Observability health validation remains mandatory."
fi

echo "Verifying observability infrastructure health..."
pnpm test:infra:observability

echo "Running boilerplate meta-tests..."
if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
  pnpm exec vitest run -c vitest.boilerplate.workspace.ts "${PASSTHROUGH_ARGS[@]}"
else
  pnpm exec vitest run -c vitest.boilerplate.workspace.ts
fi
