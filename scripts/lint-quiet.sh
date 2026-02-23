#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

FILTER="${1:-}"
PACKAGES=()
while IFS= read -r package_name; do
  [[ -n "$package_name" ]] && PACKAGES+=("$package_name")
done < <(node "$SCRIPT_DIR/lib/discover-packages-with-script.mjs" lint)

echo "Running lint (quiet mode)"

FAILED_PACKAGES=()
PASSED_COUNT=0

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  echo "No workspace packages expose a lint script."
  exit 1
fi

for pkg in "${PACKAGES[@]}"; do
  if [[ -n "$FILTER" ]] && [[ "$pkg" != *"$FILTER"* ]]; then
    continue
  fi

  if run_silent "$pkg" "pnpm exec turbo run lint --filter='$pkg'"; then
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    FAILED_PACKAGES+=("$pkg")
  fi
done

if ! run_silent "lint invariants" "pnpm lint:invariants"; then
  FAILED_PACKAGES+=("lint:invariants")
fi

if ! run_silent "lint ci env" "pnpm lint:ci-env"; then
  FAILED_PACKAGES+=("lint:ci-env")
fi

if ! run_silent "lint shell" "pnpm lint:shell"; then
  FAILED_PACKAGES+=("lint:shell")
fi

if [[ ${#FAILED_PACKAGES[@]} -gt 0 ]]; then
  echo "Lint failed (${#FAILED_PACKAGES[@]} failed, $PASSED_COUNT passed)"
  printf '%s\n' "${FAILED_PACKAGES[@]}"
  exit 1
fi

echo "Lint completed ($PASSED_COUNT passed + invariants + shell)"
