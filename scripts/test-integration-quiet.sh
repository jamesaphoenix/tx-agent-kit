#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

FILTER=""
REQUEST_SKIP_PGTAP="${INTEGRATION_SKIP_PGTAP:-}"
REQUEST_DRY_RUN="${INTEGRATION_DRY_RUN:-}"

discover_integration_project_map() {
  node "$PROJECT_ROOT/scripts/lib/discover-integration-projects.mjs"
}

resolve_project_ids_from_filter() {
  local filter="$1"
  local project_ids=()
  local normalized_filter
  normalized_filter="$(echo "$filter" | tr '[:upper:]' '[:lower:]')"

  while IFS=$'\t' read -r package_name project_id _config_path; do
    if [[ -z "$package_name" || -z "$project_id" ]]; then
      continue
    fi

    local normalized_package_name
    normalized_package_name="$(echo "$package_name" | tr '[:upper:]' '[:lower:]')"
    if [[ "$normalized_package_name" == *"$normalized_filter"* ]]; then
      project_ids+=("$project_id")
    fi
  done < <(discover_integration_project_map)

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

  if [[ "$arg" == "--dry-run" ]]; then
    REQUEST_DRY_RUN="1"
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

if [[ -n "$REQUEST_DRY_RUN" ]]; then
  if [[ -n "$FILTER" ]]; then
    if ! project_ids="$(resolve_project_ids_from_filter "$FILTER")"; then
      echo "No integration projects matched filter: '$FILTER'"
      exit 1
    fi
    echo "Integration quiet runner dry-run summary:"
    echo "  INTEGRATION_PROJECTS=$project_ids"
  else
    echo "Integration quiet runner dry-run summary:"
    echo "  INTEGRATION_PROJECTS=all"
  fi
  echo "  INTEGRATION_SKIP_PGTAP=${REQUEST_SKIP_PGTAP:-0}"
  exit 0
fi

if [[ "${INTEGRATION_SKIP_INFRA_ENSURE:-0}" != "1" ]]; then
  if ! run_silent "infra ensure" "pnpm infra:ensure"; then
    echo "Integration tests failed"
    exit 1
  fi

  if [[ "${TEMPORAL_RUNTIME_MODE:-cli}" == "cli" ]]; then
    if ! run_silent "temporal cli ensure" "pnpm temporal:dev:up"; then
      echo "Integration tests failed"
      exit 1
    fi
  fi
else
  echo "Skipping infra ensure bootstrap (INTEGRATION_SKIP_INFRA_ENSURE=1)"
  echo "Observability health check remains mandatory"
fi

if ! run_silent "observability infra health" "pnpm test:infra:observability"; then
  echo "Integration tests failed"
  exit 1
fi

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
