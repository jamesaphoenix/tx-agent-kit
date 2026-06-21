#!/usr/bin/env bash
# INTERNAL affected-only INTEGRATION test helper (no user-facing pnpm command).
#
# This is the engine behind the affected-by-default LOCAL behavior of
# `pnpm test:integration` and `pnpm test:integration:quiet`. The quiet runner
# (scripts/test-integration-quiet.sh) execs into this helper when it is the
# local default; this helper computes the affected set and execs BACK into the
# quiet runner with INTEGRATION_PROJECTS + TX_INTEGRATION_AFFECTED_ACTIVE set.
# There is intentionally NO `:affected` pnpm script - affected is the default,
# not an opt-in suffix.
#
# Computes the affected integration PROJECTS since a base ref using turbo's
# NATIVE affected graph (no bespoke git porcelain parsing), then runs ONLY those
# projects through the quiet integration runner via its INTEGRATION_PROJECTS
# contract.
#
# CI always runs the FULL integration suite (the quiet runner never reaches this
# helper when CI=true). This exists only for a faster local loop.
#
# Affected computation:
#   scripts/lib/affected-integration-projects.mjs runs
#     `turbo run test:integration --filter=...[<ref>] --dry-run=json`,
#   keeps real (non-`<NONEXISTENT>`) test:integration task packages, and
#   intersects them with scripts/lib/discover-integration-projects.mjs to map
#   package names to the project IDs the workspace runner consumes.
#
# Base ref resolution: positional arg > TX_INTEGRATION_BASE_REF > origin/main.
# Pass `--plan` (or set INTEGRATION_AFFECTED_PLAN_ONLY=1) to print the resolved
# decision (FULL vs the affected project CSV) and exit without running anything.
#
# Correctness safeguards (mirror scripts/lint-ci.sh): FALL BACK to FULL on ANY
# ambiguity (no base ref, detached/unknown ref, turbo/JSON failure) or when a
# sentinel path changed; and ALWAYS include the `api` core project so a core
# integration smoke runs even when the affected set is narrow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/affected-base-ref.sh
source "$SCRIPT_DIR/lib/affected-base-ref.sh"

cd "$PROJECT_ROOT"

PLAN_ONLY="${INTEGRATION_AFFECTED_PLAN_ONLY:-0}"
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

# Single source of truth: resolve the affected decision (FULL sentinel or a
# project CSV) + a human reason. Same helper the non-quiet runner uses. The
# decision goes to stdout; the human reason goes to stderr, captured via a temp
# file so it can feed the banner without interleaving with stdout.
REASON_FILE="$(mktemp)"
DECISION="$(resolve_affected_integration_decision "$BASE_REF_ARG" "$SCRIPT_DIR/lib" 2>"$REASON_FILE")"
REASON="$(cat "$REASON_FILE")"
rm -f "$REASON_FILE"

if [[ "$DECISION" == "$FULL_INTEGRATION_SENTINEL" ]]; then
  if [[ "$PLAN_ONLY" == "1" ]]; then
    echo "PLAN: FULL integration suite ($REASON)"
    exit 0
  fi
  echo "FULL: $REASON"
  # TX_INTEGRATION_AFFECTED_ACTIVE marks the delegated quiet-runner invocation so
  # it does NOT re-enter affected routing (the recursion guard).
  exec env TX_INTEGRATION_AFFECTED_ACTIVE=1 "$SCRIPT_DIR/test-integration-quiet.sh"
fi

if [[ "$PLAN_ONLY" == "1" ]]; then
  echo "PLAN: AFFECTED integration projects ($REASON): $DECISION"
  exit 0
fi

echo "AFFECTED: $DECISION ($REASON)"
echo "(CI always runs the full integration suite; this is a local convenience.)"
exec env \
  INTEGRATION_PROJECTS="$DECISION" \
  TX_INTEGRATION_AFFECTED_ACTIVE=1 \
  "$SCRIPT_DIR/test-integration-quiet.sh"
