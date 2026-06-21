#!/usr/bin/env bash
# Per-file flake-repro helper.
#
# Runs ONE integration test file (or `-t` name pattern) inside ONE project,
# repeatedly, and STOPS on the FIRST failure printing the iteration number.
# Infra is ensured ONCE (first iteration), then INTEGRATION_SKIP_INFRA_ENSURE=1
# for every subsequent iteration so the loop is fast and never tears infra down.
#
# Usage:
#   pnpm test:integration:repeat <project> <file-or-pattern> [count=20]
#
# Examples:
#   pnpm test:integration:repeat web "apps/web/.../members/page.integration.test.tsx"
#   pnpm test:integration:repeat web "members" 50        # -t name/path substring
#
# Notes:
#   - <project> is an integration project ID (api, web, worker, mobile,
#     observability, testkit). It scopes the workspace to exactly that project.
#   - <file-or-pattern> is forwarded to vitest. A path runs that file; any other
#     value is matched as a vitest test-name/path filter (vitest treats a bare
#     positional as a filename pattern).
#   - This is a LOCAL debugging tool. It does not change CI behavior and is never
#     wired into CI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

cd "$PROJECT_ROOT"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  # Materialize op:// references before the shared API test server boots, the
  # same way the quiet/full runners do.
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/scripts/lib/source-env.sh"
  source_env "$PROJECT_ROOT/.env"
fi

PROJECT="${1:-}"
PATTERN="${2:-}"
COUNT="${3:-20}"

if [[ -z "$PROJECT" || -z "$PATTERN" ]]; then
  echo "Usage: pnpm test:integration:repeat <project> <file-or-pattern> [count=20]" >&2
  echo "Example: pnpm test:integration:repeat web \"members/page.integration.test.tsx\" 30" >&2
  exit 2
fi

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || (( COUNT < 1 )); then
  echo "count must be a positive integer (got '$COUNT')" >&2
  exit 2
fi

# Validate the project ID against the canonical map so a typo fails fast instead
# of running the wrong (or full) suite.
KNOWN_PROJECT_IDS="$(node "$PROJECT_ROOT/scripts/lib/discover-integration-projects.mjs" | cut -f2 | sort -u | paste -sd, -)"
PROJECT_LOWER="$(printf '%s' "$PROJECT" | tr '[:upper:]' '[:lower:]')"
if [[ ",$KNOWN_PROJECT_IDS," != *",$PROJECT_LOWER,"* ]]; then
  echo "Unknown integration project '$PROJECT'. Known projects: $KNOWN_PROJECT_IDS" >&2
  exit 2
fi

echo "================================================================"
echo "Flake-repro: project=$PROJECT pattern='$PATTERN' iterations=$COUNT"
echo "================================================================"

run_one_iteration() {
  # Scope the workspace to ONE project via INTEGRATION_PROJECTS and forward the
  # pattern to vitest. We invoke vitest directly (not the quiet/full runner) so
  # the loop never re-runs infra ensure or the wall-clock budget - infra is
  # ensured once by the caller before the loop starts.
  env \
    INTEGRATION_PROJECTS="$PROJECT_LOWER" \
    pnpm exec vitest run -c vitest.integration.workspace.ts "$PATTERN"
}

for (( iteration = 1; iteration <= COUNT; iteration++ )); do
  if (( iteration == 1 )); then
    # First iteration ensures infra (and runs the observability preflight).
    skip_infra="${INTEGRATION_SKIP_INFRA_ENSURE:-0}"
    echo ""
    echo "---- iteration $iteration/$COUNT (ensuring infra) ----"
    if [[ "$skip_infra" != "1" ]]; then
      run_silent "infra ensure" "pnpm infra:ensure"
      if [[ "${TEMPORAL_RUNTIME_MODE:-cli}" == "cli" ]]; then
        run_silent "temporal cli ensure" "pnpm temporal:dev:up"
      fi
    fi
    if [[ "${INTEGRATION_SKIP_OBSERVABILITY:-0}" != "1" ]]; then
      run_silent "observability infra health" "pnpm test:infra:observability"
    fi
  else
    echo ""
    echo "---- iteration $iteration/$COUNT ----"
  fi

  # Infra was ensured above on iteration 1, so EVERY vitest invocation skips the
  # bootstrap (the loop never re-ensures or tears infra down).
  set +e
  run_one_iteration
  iteration_exit=$?
  set -e

  if (( iteration_exit != 0 )); then
    echo ""
    echo "================================================================"
    echo "FLAKE REPRODUCED on iteration $iteration/$COUNT (vitest exit=$iteration_exit)"
    echo "project=$PROJECT pattern='$PATTERN'"
    echo "================================================================"
    exit 1
  fi

  echo "iteration $iteration/$COUNT: PASS"
done

echo ""
echo "================================================================"
echo "No failure across $COUNT iterations (project=$PROJECT pattern='$PATTERN')"
echo "================================================================"
