#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

FILTER="${1:-}"
PACKAGES=(
  "@tx-agent-kit/contracts"
  "@tx-agent-kit/logging"
  "@tx-agent-kit/auth"
  "@tx-agent-kit/db"
  "@tx-agent-kit/testkit"
  "@tx-agent-kit/core"
  "@tx-agent-kit/observability"
  "@tx-agent-kit/temporal-client"
  "@tx-agent-kit/scaffold"
  "@tx-agent-kit/api"
  "@tx-agent-kit/worker"
  "@tx-agent-kit/web"
  "@tx-agent-kit/mobile"
)

echo "Running unit tests (quiet mode)"

FAILED_PACKAGES=()
PASSED_COUNT=0

for pkg in "${PACKAGES[@]}"; do
  if [[ -n "$FILTER" ]] && [[ "$pkg" != *"$FILTER"* ]]; then
    continue
  fi

  if run_silent "$pkg" "pnpm exec turbo run test --filter='$pkg'"; then
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    FAILED_PACKAGES+=("$pkg")
  fi
done

if [[ ${#FAILED_PACKAGES[@]} -gt 0 ]]; then
  echo "Unit tests failed (${#FAILED_PACKAGES[@]} failed, $PASSED_COUNT passed)"
  printf '%s\n' "${FAILED_PACKAGES[@]}"
  exit 1
fi

echo "Unit tests completed ($PASSED_COUNT passed)"
