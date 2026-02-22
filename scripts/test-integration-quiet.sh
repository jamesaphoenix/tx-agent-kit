#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

FILTER=""
REQUEST_SKIP_PGTAP="${INTEGRATION_SKIP_PGTAP:-}"

INTEGRATION_PACKAGE_MAP=(
  "@tx-agent-kit/api:api"
  "@tx-agent-kit/testkit:testkit"
  "@tx-agent-kit/web:web"
  "@tx-agent-kit/worker:worker"
)

resolve_project_ids_from_filter() {
  local filter="$1"
  local project_ids=()

  for mapping in "${INTEGRATION_PACKAGE_MAP[@]}"; do
    local package_name="${mapping%%:*}"
    local project_id="${mapping##*:}"

    if [[ "$package_name" == *"$filter"* ]]; then
      project_ids+=("$project_id")
    fi
  done

  if [[ ${#project_ids[@]} -eq 0 ]]; then
    return 1
  fi

  local csv
  csv="$(IFS=,; echo "${project_ids[*]}")"
  printf '%s\n' "$csv"
}

echo "Running integration tests (quiet mode, global workspace setup)"

ARGS=("$@")
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  arg="${ARGS[$i]}"

  if [[ "$arg" == "--" ]]; then
    i=$((i + 1))
    continue
  fi

  if [[ "$arg" == --filter=* ]]; then
    FILTER="${arg#--filter=}"
    i=$((i + 1))
    continue
  fi

  if [[ "$arg" == "--filter" ]]; then
    if [[ $((i + 1)) -ge ${#ARGS[@]} ]]; then
      echo "Missing value for --filter"
      exit 1
    fi
    FILTER="${ARGS[$((i + 1))]}"
    i=$((i + 2))
    continue
  fi

  if [[ "$arg" == "--skip-pgtap" ]]; then
    REQUEST_SKIP_PGTAP="1"
    i=$((i + 1))
    continue
  fi

  if [[ -z "$FILTER" ]]; then
    FILTER="$arg"
    i=$((i + 1))
    continue
  fi

  echo "Unknown argument: $arg"
  exit 1
done

env_prefix_cmd=""
if [[ -n "$REQUEST_SKIP_PGTAP" ]]; then
  env_prefix_cmd="INTEGRATION_SKIP_PGTAP=$REQUEST_SKIP_PGTAP "
fi

if [[ -n "$FILTER" ]]; then
  if ! project_ids="$(resolve_project_ids_from_filter "$FILTER")"; then
    echo "No integration projects matched filter: '$FILTER'"
    exit 1
  fi

  if ! run_silent "integration workspace (projects=$project_ids)" "${env_prefix_cmd}INTEGRATION_PROJECTS=$project_ids pnpm exec vitest run -c vitest.integration.workspace.ts"; then
    echo "Integration tests failed"
    exit 1
  fi

  echo "Integration tests completed (filtered)"
  exit 0
fi

if ! run_silent "integration workspace (all projects)" "${env_prefix_cmd}pnpm exec vitest run -c vitest.integration.workspace.ts"; then
  echo "Integration tests failed"
  exit 1
fi

echo "Integration tests completed"
