#!/usr/bin/env bash
# Workspace-level integration test runner.
# Uses a single Vitest workspace invocation with one global setup/teardown.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Affected-decision helpers (shared with scripts/test-integration-affected.sh).
# shellcheck source=scripts/lib/affected-base-ref.sh
source "$PROJECT_ROOT/scripts/lib/affected-base-ref.sh"

source_local_env() {
  if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
    return 0
  fi

  if [[ "${CI:-}" == "true" && "${TX_SOURCE_ENV_IN_CI:-0}" != "1" ]]; then
    echo "Skipping local .env sourcing in CI (set TX_SOURCE_ENV_IN_CI=1 to opt in)."
    return 0
  fi

  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/scripts/lib/source-env.sh"
  source_env "$PROJECT_ROOT/.env"
}

source_generated_local_infra_env() {
  local env_file="$PROJECT_ROOT/.artifacts/local-infra.env"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

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
REQUEST_DRY_RUN="${INTEGRATION_DRY_RUN:-}"
REQUEST_PLAN="${INTEGRATION_AFFECTED_PLAN_ONLY:-}"
REQUESTED_BY_FILTER=0

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
    if [[ "$REQUESTED_BY_FILTER" == "0" ]]; then
      REQUESTED_PROJECT_IDS=""
      REQUESTED_BY_FILTER=1
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
    if [[ "$REQUESTED_BY_FILTER" == "0" ]]; then
      REQUESTED_PROJECT_IDS=""
      REQUESTED_BY_FILTER=1
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

  if [[ "$arg" == "--dry-run" ]]; then
    REQUEST_DRY_RUN="1"
    i=$((i + 1))
    continue
  fi

  if [[ "$arg" == "--plan" ]]; then
    REQUEST_PLAN="1"
    i=$((i + 1))
    continue
  fi

  PASSTHROUGH_ARGS+=("$arg")
  i=$((i + 1))
done

# ── Affected-by-default routing (LOCAL ONLY) ─────────────────────────
# `pnpm test:integration` (this non-quiet runner) runs ONLY the affected
# projects locally, exactly like the quiet runner. CI is ALWAYS full and the
# affected path is UNREACHABLE when CI=true. We do NOT narrow when the caller
# already scoped (filter / passthrough file / INTEGRATION_PROJECTS), forced full
# (TX_INTEGRATION_FULL=1), or this is a delegated invocation
# (TX_INTEGRATION_AFFECTED_ACTIVE=1, the recursion guard).
should_route_to_affected_full_runner() {
  if [[ "${CI:-}" == "true" ]]; then
    return 1
  fi
  if [[ "${TX_INTEGRATION_FULL:-0}" == "1" ]]; then
    return 1
  fi
  if [[ "${TX_INTEGRATION_AFFECTED_ACTIVE:-0}" == "1" ]]; then
    return 1
  fi
  if [[ -n "$REQUESTED_PROJECT_IDS" ]]; then
    return 1
  fi
  if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
    return 1
  fi
  return 0
}

if [[ -n "$REQUEST_PLAN" ]]; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "PLAN: FULL integration suite (CI; affected selection is never used in CI)"
  elif [[ "${TX_INTEGRATION_FULL:-0}" == "1" ]]; then
    echo "PLAN: FULL integration suite (TX_INTEGRATION_FULL=1 local opt-out)"
  elif [[ -n "$REQUESTED_PROJECT_IDS" ]]; then
    echo "PLAN: scoped integration suite (INTEGRATION_PROJECTS=$(dedupe_csv "$REQUESTED_PROJECT_IDS"))"
  elif [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
    echo "PLAN: scoped integration suite (passthrough ${PASSTHROUGH_ARGS[*]})"
  else
    plan_reason_file="$(mktemp)"
    plan_decision="$(resolve_affected_integration_decision "" "$PROJECT_ROOT/scripts/lib" 2>"$plan_reason_file")"
    plan_reason="$(cat "$plan_reason_file")"
    rm -f "$plan_reason_file"
    if [[ "$plan_decision" == "$FULL_INTEGRATION_SENTINEL" ]]; then
      echo "PLAN: FULL integration suite ($plan_reason)"
    else
      echo "PLAN: AFFECTED integration projects ($plan_reason): $plan_decision"
    fi
  fi
  exit 0
fi

if should_route_to_affected_full_runner; then
  affected_reason_file="$(mktemp)"
  affected_decision="$(resolve_affected_integration_decision "" "$PROJECT_ROOT/scripts/lib" 2>"$affected_reason_file")"
  affected_reason="$(cat "$affected_reason_file")"
  rm -f "$affected_reason_file"
  if [[ "$affected_decision" == "$FULL_INTEGRATION_SENTINEL" ]]; then
    echo "FULL: $affected_reason"
  else
    echo "AFFECTED: $affected_decision ($affected_reason)"
    echo "(CI always runs the full integration suite; this is a local convenience.)"
    REQUESTED_PROJECT_IDS="$affected_decision"
  fi
else
  if [[ "${CI:-}" == "true" ]]; then
    echo "FULL: CI (affected selection is never used in CI)"
  elif [[ "${TX_INTEGRATION_FULL:-0}" == "1" ]]; then
    echo "FULL: TX_INTEGRATION_FULL=1 (local opt-out)"
  fi
fi

if [[ -n "$REQUESTED_PROJECT_IDS" ]]; then
  export INTEGRATION_PROJECTS
  INTEGRATION_PROJECTS="$(dedupe_csv "$REQUESTED_PROJECT_IDS")"
fi

if [[ -n "$REQUEST_SKIP_PGTAP" ]]; then
  export INTEGRATION_SKIP_PGTAP
  INTEGRATION_SKIP_PGTAP="$REQUEST_SKIP_PGTAP"
fi

if [[ -n "$REQUEST_DRY_RUN" ]]; then
  echo "Integration runner dry-run summary:"
  echo "  INTEGRATION_PROJECTS=${INTEGRATION_PROJECTS:-all}"
  echo "  INTEGRATION_SKIP_PGTAP=${INTEGRATION_SKIP_PGTAP:-0}"
  if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
    echo "  PASSTHROUGH_ARGS=${PASSTHROUGH_ARGS[*]}"
  else
    echo "  PASSTHROUGH_ARGS=(none)"
  fi
  exit 0
fi

if [[ "${INTEGRATION_SKIP_INFRA_ENSURE:-0}" != "1" ]]; then
  echo "Ensuring integration infrastructure..."
  pnpm infra:ensure
  source_local_env
  source_generated_local_infra_env

  local_temporal_mode="${TEMPORAL_RUNTIME_MODE:-cli}"
  if [[ "$local_temporal_mode" == "cli" ]]; then
    echo "Ensuring local Temporal CLI runtime..."
    pnpm temporal:dev:up
  fi

else
  echo "Skipping infra ensure bootstrap (INTEGRATION_SKIP_INFRA_ENSURE=1)."
  source_local_env
  source_generated_local_infra_env
  if [[ "${INTEGRATION_SKIP_OBSERVABILITY:-0}" != "1" ]]; then
    echo "Observability health validation remains mandatory."
  fi
fi

if [[ "${INTEGRATION_SKIP_OBSERVABILITY:-0}" != "1" ]]; then
  echo "Verifying observability infrastructure health..."
  pnpm test:infra:observability
else
  echo "Skipping observability health validation (INTEGRATION_SKIP_OBSERVABILITY=1)."
fi

echo "Running integration tests..."
if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
  pnpm exec vitest run -c vitest.integration.workspace.ts "${PASSTHROUGH_ARGS[@]}"
else
  pnpm exec vitest run -c vitest.integration.workspace.ts
fi
