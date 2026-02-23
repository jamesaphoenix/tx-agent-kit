#!/usr/bin/env bash
# Workspace-level integration test runner.
# Uses a single Vitest workspace invocation with one global setup/teardown.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

discover_integration_project_map() {
  node "$PROJECT_ROOT/scripts/lib/discover-integration-projects.mjs"
}

dedupe_csv() {
  local raw_csv="$1"
  local normalized=""

  IFS=',' read -r -a tokens <<< "$raw_csv"
  for token in "${tokens[@]}"; do
    local trimmed
    trimmed="$(echo "$token" | tr '[:upper:]' '[:lower:]' | xargs)"
    if [[ -z "$trimmed" ]]; then
      continue
    fi

    if [[ ",$normalized," == *",$trimmed,"* ]]; then
      continue
    fi

    if [[ -n "$normalized" ]]; then
      normalized="$normalized,$trimmed"
    else
      normalized="$trimmed"
    fi
  done

  printf '%s\n' "$normalized"
}

resolve_project_ids_from_filter() {
  local filter="$1"
  local project_ids=""
  local normalized_filter
  normalized_filter="$(echo "$filter" | tr '[:upper:]' '[:lower:]')"

  while IFS=$'\t' read -r package_name project_id _config_path; do
    if [[ -z "$package_name" || -z "$project_id" ]]; then
      continue
    fi

    local normalized_package_name
    normalized_package_name="$(echo "$package_name" | tr '[:upper:]' '[:lower:]')"
    if [[ "$normalized_package_name" == *"$normalized_filter"* ]]; then
      if [[ -n "$project_ids" ]]; then
        project_ids="$project_ids,$project_id"
      else
        project_ids="$project_id"
      fi
    fi
  done < <(discover_integration_project_map)

  printf '%s\n' "$project_ids"
}

ARGS=("$@")
if [[ "${ARGS[0]:-}" == "--" ]]; then
  ARGS=("${ARGS[@]:1}")
fi

PASSTHROUGH_ARGS=()
REQUESTED_PROJECT_IDS="${INTEGRATION_PROJECTS:-}"
REQUEST_SKIP_PGTAP="${INTEGRATION_SKIP_PGTAP:-}"

i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  arg="${ARGS[$i]}"

  if [[ "$arg" == --filter=* ]]; then
    filter="${arg#--filter=}"
    matched_ids="$(resolve_project_ids_from_filter "$filter")"
    if [[ -z "$matched_ids" ]]; then
      echo "No integration projects matched filter: '$filter'"
      exit 1
    fi
    if [[ -n "$REQUESTED_PROJECT_IDS" ]]; then
      REQUESTED_PROJECT_IDS="$REQUESTED_PROJECT_IDS,$matched_ids"
    else
      REQUESTED_PROJECT_IDS="$matched_ids"
    fi
    i=$((i + 1))
    continue
  fi

  if [[ "$arg" == "--filter" ]]; then
    if [[ $((i + 1)) -ge ${#ARGS[@]} ]]; then
      echo "Missing value for --filter"
      exit 1
    fi

    filter="${ARGS[$((i + 1))]}"
    matched_ids="$(resolve_project_ids_from_filter "$filter")"
    if [[ -z "$matched_ids" ]]; then
      echo "No integration projects matched filter: '$filter'"
      exit 1
    fi
    if [[ -n "$REQUESTED_PROJECT_IDS" ]]; then
      REQUESTED_PROJECT_IDS="$REQUESTED_PROJECT_IDS,$matched_ids"
    else
      REQUESTED_PROJECT_IDS="$matched_ids"
    fi
    i=$((i + 2))
    continue
  fi

  if [[ "$arg" == "--skip-pgtap" ]]; then
    REQUEST_SKIP_PGTAP="1"
    i=$((i + 1))
    continue
  fi

  PASSTHROUGH_ARGS+=("$arg")
  i=$((i + 1))
done

if [[ -n "$REQUESTED_PROJECT_IDS" ]]; then
  export INTEGRATION_PROJECTS
  INTEGRATION_PROJECTS="$(dedupe_csv "$REQUESTED_PROJECT_IDS")"
fi

if [[ -n "$REQUEST_SKIP_PGTAP" ]]; then
  export INTEGRATION_SKIP_PGTAP
  INTEGRATION_SKIP_PGTAP="$REQUEST_SKIP_PGTAP"
fi

echo "Running integration tests..."
if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
  pnpm exec vitest run -c vitest.integration.workspace.ts "${PASSTHROUGH_ARGS[@]}"
else
  pnpm exec vitest run -c vitest.integration.workspace.ts
fi
