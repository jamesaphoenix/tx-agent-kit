#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

FILTER="${1:-}"
PACKAGES=()
while IFS= read -r package_name; do
  [[ -n "$package_name" ]] && PACKAGES+=("$package_name")
done < <(node "$SCRIPT_DIR/lib/discover-packages-with-script.mjs" type-check)

echo "Running type-check (quiet mode)"

FAILED_PACKAGES=()
PASSED_COUNT=0

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  echo "No workspace packages expose a type-check script."
  exit 1
fi

for pkg in "${PACKAGES[@]}"; do
  if [[ -n "$FILTER" ]] && [[ "$pkg" != *"$FILTER"* ]]; then
    continue
  fi

  if run_silent "$pkg" "pnpm exec turbo run type-check --filter='$pkg'"; then
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    FAILED_PACKAGES+=("$pkg")
  fi
done

if [[ ${#FAILED_PACKAGES[@]} -gt 0 ]]; then
  echo "Type-check failed (${#FAILED_PACKAGES[@]} failed, $PASSED_COUNT passed)"
  printf '%s\n' "${FAILED_PACKAGES[@]}"
  exit 1
fi

echo "Type-check completed ($PASSED_COUNT passed)"
