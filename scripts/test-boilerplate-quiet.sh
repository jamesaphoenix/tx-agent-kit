#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR" && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

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
  echo "Boilerplate quiet runner dry-run summary:"
  echo "  BOILERPLATE_SKIP_INFRA_ENSURE=${BOILERPLATE_SKIP_INFRA_ENSURE:-0}"
  if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
    echo "  PASSTHROUGH_ARGS=${PASSTHROUGH_ARGS[*]}"
  else
    echo "  PASSTHROUGH_ARGS=(none)"
  fi
  exit 0
fi

if [[ "${BOILERPLATE_SKIP_INFRA_ENSURE:-0}" != "1" ]]; then
  if ! run_silent "infra ensure" "pnpm infra:ensure"; then
    echo "Boilerplate meta-tests failed"
    exit 1
  fi

  if [[ "${TEMPORAL_RUNTIME_MODE:-cli}" == "cli" ]]; then
    if ! run_silent "temporal cli ensure" "pnpm temporal:dev:up"; then
      echo "Boilerplate meta-tests failed"
      exit 1
    fi
  fi
else
  echo "Skipping infra ensure bootstrap (BOILERPLATE_SKIP_INFRA_ENSURE=1)"
  echo "Observability health check remains mandatory"
fi

if ! run_silent "observability infra health" "pnpm test:infra:observability"; then
  echo "Boilerplate meta-tests failed"
  exit 1
fi

vitest_cmd="pnpm exec vitest run -c vitest.boilerplate.workspace.ts"
if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
  passthrough_quoted=""
  for arg in "${PASSTHROUGH_ARGS[@]}"; do
    passthrough_quoted+=" $(printf '%q' "$arg")"
  done
  vitest_cmd+="$passthrough_quoted"
fi

if ! run_silent "boilerplate workspace" "$vitest_cmd"; then
  echo "Boilerplate meta-tests failed"
  exit 1
fi

echo "Boilerplate meta-tests completed"
