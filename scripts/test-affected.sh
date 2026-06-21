#!/usr/bin/env bash
# LOCAL affected-only UNIT test runner (additive convenience).
#
# Runs `turbo run test` only for packages affected since a base ref, using
# turbo's NATIVE affected graph (`--filter=...[<ref>]`), which includes the
# changed packages plus their transitive dependents.
#
# This NEVER changes the default `pnpm test` / `pnpm test:integration` behavior,
# and CI always runs the FULL suite. It only exists so local devs can get a
# faster inner loop.
#
# Base ref resolution: positional arg > TX_INTEGRATION_BASE_REF > origin/main.
# Pass `--plan` (or set TEST_AFFECTED_PLAN_ONLY=1) to print the resolved decision
# (FULL vs the affected turbo filter) and exit without running anything.
# On ANY ambiguity (no base ref, detached/unknown ref) or when a sentinel path
# changed, we FALL BACK to the full `turbo run test`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/affected-base-ref.sh
source "$SCRIPT_DIR/lib/affected-base-ref.sh"

cd "$PROJECT_ROOT"

PLAN_ONLY="${TEST_AFFECTED_PLAN_ONLY:-0}"
BASE_REF_ARG=""
for arg in "$@"; do
  if [[ "$arg" == "--plan" ]]; then
    PLAN_ONLY="1"
    continue
  fi
  if [[ -z "$BASE_REF_ARG" ]]; then
    BASE_REF_ARG="$arg"
    continue
  fi
  echo "Unknown argument: $arg"
  exit 1
done

BASE_REF="$(resolve_affected_base_ref "$BASE_REF_ARG")"

run_full() {
  local reason="$1"
  if [[ "$PLAN_ONLY" == "1" ]]; then
    echo "PLAN: FULL unit test suite ($reason)"
    exit 0
  fi
  echo "Running FULL unit test suite: $reason"
  pnpm exec turbo run test
}

if ! affected_base_ref_is_usable "$BASE_REF"; then
  run_full "no usable base ref (resolved='${BASE_REF}')"
  exit 0
fi

SENTINEL_CHANGES="$(changed_sentinel_paths "$BASE_REF")"
if [[ -n "$SENTINEL_CHANGES" ]]; then
  echo "Sentinel inputs changed since $BASE_REF:"
  printf '  %s\n' $SENTINEL_CHANGES
  run_full "sentinel inputs changed"
  exit 0
fi

if [[ "$PLAN_ONLY" == "1" ]]; then
  echo "PLAN: affected unit tests since $BASE_REF (turbo run test --filter=...[$BASE_REF])"
  exit 0
fi

echo "Running affected unit tests since $BASE_REF (turbo --filter=...[$BASE_REF])."
pnpm exec turbo run test --filter="...[$BASE_REF]"
