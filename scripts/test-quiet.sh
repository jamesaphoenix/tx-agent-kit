#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FILTER="${1:-}"

# Discover the workspace packages that actually expose a `test` script. This
# filtering matters: a bare `turbo run test` also matches packages whose `test`
# task exists only in turbo's graph (e.g. docs / vitest-config) with no real
# script, which would silently expand the suite. Driving turbo with an explicit
# per-package --filter list keeps the set identical to the old serial loop.
PACKAGES=()
while IFS= read -r package_name; do
  [[ -z "$package_name" ]] && continue
  # Honour the optional substring FILTER arg, exactly as the serial loop did.
  if [[ -n "$FILTER" ]] && [[ "$package_name" != *"$FILTER"* ]]; then
    continue
  fi
  PACKAGES+=("$package_name")
done < <(node "$SCRIPT_DIR/lib/discover-packages-with-script.mjs" test)

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  if [[ -n "$FILTER" ]]; then
    echo "No workspace packages with a test script match filter '$FILTER'."
  else
    echo "No workspace packages expose a test script."
  fi
  exit 1
fi

echo "Running unit tests (quiet mode) across ${#PACKAGES[@]} packages"

# Build a single turbo invocation with one --filter per discovered package so
# turbo parallelises the whole test DAG in one run instead of N serial runs.
# --output-logs=errors-only keeps successful packages quiet while still printing
# full output for any failing task, preserving the quiet-on-success contract.
FILTER_ARGS=()
for pkg in "${PACKAGES[@]}"; do
  FILTER_ARGS+=(--filter="$pkg")
done

status=0
pnpm exec turbo run test "${FILTER_ARGS[@]}" --output-logs=errors-only || status=$?

if [[ "$status" -eq 0 ]]; then
  echo "Unit tests completed (${#PACKAGES[@]} packages passed)"
else
  echo "Unit tests failed (see output above)"
  exit "$status"
fi
