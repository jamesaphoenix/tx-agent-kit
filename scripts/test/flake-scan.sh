#!/usr/bin/env bash
# flake-scan: run the integration suite N times and rank the tests that fail,
# so we prioritize flake fixes by REAL frequency (not by a static pattern count).
#
# The suite is contention-driven: a test that passes in isolation can fail under
# the full parallel load. Running it N times surfaces the actual flaky set.
#
# Usage:
#   scripts/test/flake-scan.sh [N]                 # N full-suite runs (default 5)
#   scripts/test/flake-scan.sh [N] --filter web    # restrict to a project
#   FLAKE_SCAN_RUNS=8 scripts/test/flake-scan.sh    # N via env
#
# Output: per-run PASS/FAIL, then a ranked table of "fail count / N" per test,
# plus the set of files those tests live in. Exit 0 if zero failures across all
# runs, else 1.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

RUNS="${1:-${FLAKE_SCAN_RUNS:-5}}"
case "$RUNS" in
  ''|*[!0-9]*) PASSTHROUGH=("$@"); RUNS="${FLAKE_SCAN_RUNS:-5}" ;;
  *) shift || true; PASSTHROUGH=("$@") ;;
esac

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT
FAILS_FILE="$OUT_DIR/fails.txt"
: >"$FAILS_FILE"

strip_ansi() { sed 's/\x1b\[[0-9;]*m//g'; }

echo "flake-scan: $RUNS run(s) of the integration suite${PASSTHROUGH:+ (args: ${PASSTHROUGH[*]})}"
echo "============================================================"

# Ensure workspace dist is fresh BEFORE the scan. Stale dist (common after a
# `git checkout`/branch reset in a worktree where the prior build is left behind)
# makes integration suites fail to COLLECT with a module-load `TypeError` (e.g. a
# barrel export missing from the old dist). That failure is deterministic across
# every run, so it masquerades as a hard "flake" when it is really a build-staleness
# artifact - exactly the kind of false signal a flake finder must not emit. The
# build is turbo-cached, so this is a fast no-op when dist already matches source.
# Opt out with FLAKE_SCAN_SKIP_BUILD=1 (e.g. when iterating on the scan itself).
if [ "${FLAKE_SCAN_SKIP_BUILD:-0}" != "1" ]; then
  echo "Ensuring workspace build is fresh (turbo-cached; FLAKE_SCAN_SKIP_BUILD=1 to skip)..."
  if ! pnpm build >"$OUT_DIR/build.log" 2>&1; then
    echo "ERROR: workspace build failed - refusing to scan against stale/broken dist." >&2
    tail -25 "$OUT_DIR/build.log" >&2
    exit 1
  fi
  echo "  build OK"
fi
echo "============================================================"

green_runs=0
for i in $(seq 1 "$RUNS"); do
  log="$OUT_DIR/run-$i.log"
  # A failing run is expected and must NOT abort the scan, so capture the exit
  # code without letting `set -e` trip on the non-zero status.
  rc=0
  # Expand the passthrough array in a way that is safe on bash 3.2 (macOS) under
  # `set -u`: a bare "${PASSTHROUGH[@]}" throws "unbound variable" when the array
  # is empty (the no-filter, full-suite case). The `[@]+` guard yields nothing
  # when unset/empty and the quoted elements otherwise.
  CI=true ./scripts/test/run-integration.sh ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"} >"$log" 2>&1 || rc=$?
  # Failing test lines look like:  × <test name> 1234ms   (vitest)
  # Failing file lines look like:  FAIL  <project>  <path> > <suite> > <test>
  # `grep` exits non-zero when there are no matches (a green run), which is fine
  # under `set -e`; guard each with `|| true`.
  strip_ansi <"$log" | { grep -aE '^\s*(×|✗) ' || true; } | sed -E 's/^[[:space:]]*[×✗][[:space:]]+//; s/[[:space:]]+[0-9]+ms[[:space:]]*$//' >>"$FAILS_FILE"
  strip_ansi <"$log" | { grep -aE 'FAIL +(web|api|worker)-integration ' || true; } | sed -E 's/.*FAIL +/FILE: /' >>"$FAILS_FILE"
  if [ "$rc" -eq 0 ]; then
    echo "  run $i: PASS"
    green_runs=$((green_runs + 1))
  else
    summary="$(strip_ansi <"$log" | { grep -aE 'Tests +[0-9]+ failed' || true; } | tail -1 | sed -E 's/^[[:space:]]*//')"
    echo "  run $i: FAIL  ${summary:-(see log)}"
  fi
done

echo "============================================================"
echo "Green runs: $green_runs / $RUNS"
echo ""
echo "Flaky tests (fail count, ranked):"
{ grep -av '^FILE:' "$FAILS_FILE" || true; } | sort | uniq -c | sort -rn | sed 's/^/  /' | head -40
echo ""
echo "Files containing failures:"
{ grep -a '^FILE:' "$FAILS_FILE" || true; } | sed 's/^FILE: //' | awk '{print $2}' | sort -u | sed 's/^/  /' | head -40

# Exit non-zero if any run failed; this is the intended scan result, so guard it
# from `set -e` aborting before we can surface it as the script's exit code.
[ "$green_runs" -eq "$RUNS" ]
