#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

FILTER="${1:-}"
PACKAGES=(
  "@tx-agent-kit/api"
)

echo "Running integration tests (quiet mode, idempotent infra/db reset)"

run_silent "reset integration state" "pnpm db:test:reset"

FAILED_PACKAGES=()
PASSED_COUNT=0

for pkg in "${PACKAGES[@]}"; do
  if [[ -n "$FILTER" ]] && [[ "$pkg" != *"$FILTER"* ]]; then
    continue
  fi

  if run_silent "$pkg" "pnpm exec turbo run test:integration --filter='$pkg'"; then
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    FAILED_PACKAGES+=("$pkg")
  fi
done

if [[ ${#FAILED_PACKAGES[@]} -gt 0 ]]; then
  echo "Integration tests failed (${#FAILED_PACKAGES[@]} failed, $PASSED_COUNT passed)"
  printf '%s\n' "${FAILED_PACKAGES[@]}"
  exit 1
fi

echo "Integration tests completed ($PASSED_COUNT passed)"
