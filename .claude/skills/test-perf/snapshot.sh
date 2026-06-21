#!/usr/bin/env bash
# Test-suite performance snapshot for this repo.
#
# Runs the unit and/or integration suites (or a single integration project)
# and reports wall-clock time plus Vitest's own phase breakdown
# (transform / setup / import / tests / environment) and the slowest test
# files. This is the perf analogue of the lines-of-code / test-census skills:
# REPORT ONLY. It runs the existing test entry points with timing capture and
# prints numbers. It never edits, deletes, or "optimises" anything.
#
# macOS bash 3.2 compatible: no `mapfile`/`readarray`, no associative arrays;
# all iteration uses `while IFS= read -r` loops.
#
# Usage:
#   snapshot.sh                         # integration suite, full phase + slow-file report
#   snapshot.sh --unit                  # unit suite wall clock (per-package timings)
#   snapshot.sh --integration           # full integration suite (default)
#   snapshot.sh --project <id>          # one integration project: api|web|worker|testkit|...
#   snapshot.sh --slowest <N>           # show the N slowest files (default 15)
#   snapshot.sh --json                  # emit a machine-readable JSON line for trend tracking
#   snapshot.sh --runs <N>              # run the chosen suite N times, report each + the min
#
# Notes:
# - Integration runs require infra (Postgres/Redis/OTEL/Temporal). The script
#   calls `pnpm infra:ensure` itself unless --skip-infra is passed. Infra is
#   shared across worktrees and is never torn down.
# - The integration path drives Vitest directly (the workspace config) so the
#   phase line and per-file timings are visible. It does NOT bump the budget;
#   it just reads what the suite already prints.

set -u

repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$repo_root" ]; then
  echo "test-perf: not inside a git repo" >&2
  exit 2
fi
cd "$repo_root" || exit 2

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
MODE="integration"   # integration | unit
PROJECT=""
SLOWEST=15
EMIT_JSON=0
RUNS=1
SKIP_INFRA=0

while [ $# -gt 0 ]; do
  case "$1" in
    --unit)        MODE="unit"; shift ;;
    --integration) MODE="integration"; shift ;;
    --project)     MODE="integration"; PROJECT="${2:-}"; shift 2 ;;
    --slowest)     SLOWEST="${2:-15}"; shift 2 ;;
    --json)        EMIT_JSON=1; shift ;;
    --runs)        RUNS="${2:-1}"; shift 2 ;;
    --skip-infra)  SKIP_INFRA=1; shift ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0 ;;
    *)
      echo "test-perf: unknown argument '$1'" >&2
      exit 2 ;;
  esac
done

case "$SLOWEST" in
  ''|*[!0-9]*) echo "test-perf: --slowest needs a number" >&2; exit 2 ;;
esac
case "$RUNS" in
  ''|*[!0-9]*) echo "test-perf: --runs needs a number" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Strip ANSI colour codes from a stream.
strip_ansi() { sed 's/\x1b\[[0-9;]*m//g'; }

# Pull the "Duration  89.11s (transform .. setup .. import .. tests .. environment ..)"
# line out of a captured Vitest log. Echoes the raw phase text, or empty.
extract_phase_line() {
  local file="$1"
  strip_ansi <"$file" | grep -E '^\s*Duration\s+[0-9]' | tail -1 | sed -E 's/^[[:space:]]*//'
}

# Pull the Test Files / Tests summary lines.
extract_summary() {
  local file="$1"
  strip_ansi <"$file" | grep -E '^\s*(Test Files|Tests)\s+[0-9]' | sed -E 's/^[[:space:]]*//'
}

# Slowest per-file timings from a Vitest default-reporter log. Vitest prints
# one line per file ending in `<ms>ms`. We keep file-path lines only and sort
# descending by ms. Bash 3.2 safe (no process substitution into mapfile).
extract_slowest_files() {
  local file="$1"
  local n="$2"
  strip_ansi <"$file" \
    | grep -E '(src/|app/)[^ ]+\.(integration\.)?(test|spec)\.(ts|tsx|mjs|js) .*[0-9]+ms$' \
    | grep -oE '(src/|app/)[^ ]+\.(integration\.)?(test|spec)\.(ts|tsx|mjs|js).*[0-9]+ms$' \
    | awk '{ ms=$NF; gsub("ms","",ms); print ms"\t"$1 }' \
    | sort -rn \
    | head -n "$n"
}

# Source the worktree env so Vitest sees the worktree-specific DB schema /
# ports. Mirrors scripts/test/run-integration.sh. Quiet.
source_worktree_env() {
  if [ -f "$repo_root/.env" ] && [ -f "$repo_root/scripts/lib/source-env.sh" ]; then
    # shellcheck disable=SC1091
    . "$repo_root/scripts/lib/source-env.sh"
    source_env "$repo_root/.env" >/dev/null 2>&1 || true
  fi
}

# Wall clock of a command, in whole+fraction seconds. Uses bash SECONDS for
# portability (1s granularity is plenty for a multi-second suite).
run_timed() {
  local label="$1"; shift
  local start=$SECONDS
  "$@"
  local rc=$?
  LAST_ELAPSED=$((SECONDS - start))
  return $rc
}

ensure_infra() {
  if [ "$SKIP_INFRA" -eq 1 ]; then
    return 0
  fi
  echo "  ensuring infra (shared across worktrees; never torn down) ..." >&2
  pnpm infra:ensure >/dev/null 2>&1 || {
    echo "  WARN: infra:ensure reported non-zero; integration timings may be unreliable" >&2
  }
  if [ "${TEMPORAL_RUNTIME_MODE:-cli}" = "cli" ]; then
    pnpm temporal:dev:up >/dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# Unit suite snapshot
# ---------------------------------------------------------------------------
snapshot_unit() {
  local log
  log="$(mktemp)"
  echo "Running unit suite (pnpm test:quiet) ..." >&2
  run_timed "unit" sh -c 'pnpm test:quiet' >"$log" 2>&1
  local rc=$?
  local wall=$LAST_ELAPSED

  echo ""
  echo "Unit suite"
  echo "----------------------------------------------------"
  printf '  Wall clock:          %8ss\n' "$wall"
  echo "  Per-package (slowest first):"
  strip_ansi <"$log" \
    | grep -E 'OK .*\[[0-9.]+s\]' \
    | sed -E 's/.*OK (@[^ ]+).*\[([0-9.]+)s\].*/\2 \1/' \
    | sort -rn \
    | head -n "$SLOWEST" \
    | while IFS= read -r line; do
        printf '    %8ss  %s\n' "${line%% *}" "${line#* }"
      done

  if [ "$EMIT_JSON" -eq 1 ]; then
    printf '{"suite":"unit","wall_seconds":%s,"exit":%s}\n' "$wall" "$rc"
  fi

  rm -f "$log"
  UNIT_WALL=$wall
  return $rc
}

# ---------------------------------------------------------------------------
# Integration snapshot (full workspace or one project)
# ---------------------------------------------------------------------------
snapshot_integration() {
  ensure_infra
  source_worktree_env

  local label="integration (all projects)"
  local proj_env=""
  if [ -n "$PROJECT" ]; then
    label="integration project: $PROJECT"
    proj_env="INTEGRATION_PROJECTS=$PROJECT"
  fi

  local log
  log="$(mktemp)"
  echo "Running $label ..." >&2

  local cmd="$proj_env pnpm exec vitest run -c vitest.integration.workspace.ts --reporter=default"
  run_timed "$label" sh -c "$cmd" >"$log" 2>&1
  local rc=$?
  local wall=$LAST_ELAPSED

  local phase summary
  phase="$(extract_phase_line "$log")"
  summary="$(extract_summary "$log")"

  echo ""
  echo "$label"
  echo "----------------------------------------------------"
  printf '  Wall clock:          %8ss\n' "$wall"
  if [ -n "$summary" ]; then
    echo "$summary" | while IFS= read -r s; do printf '  %s\n' "$s"; done
  fi
  if [ -n "$phase" ]; then
    echo "  $phase"
  else
    echo "  (no Vitest phase line captured; run failed? see below)"
  fi

  echo ""
  echo "  Slowest files (top $SLOWEST):"
  local slow
  slow="$(extract_slowest_files "$log" "$SLOWEST")"
  if [ -n "$slow" ]; then
    printf '%s\n' "$slow" | while IFS= read -r line; do
      printf '    %8sms  %s\n' "${line%%	*}" "${line#*	}"
    done
  else
    echo "    (none reported)"
  fi

  if [ "$EMIT_JSON" -eq 1 ]; then
    # Strip the phase line down to bare numbers for trend storage.
    local t s i te e
    t=$(printf '%s' "$phase"  | grep -oE 'transform [0-9.]+' | awk '{print $2}')
    s=$(printf '%s' "$phase"  | grep -oE 'setup [0-9.]+' | awk '{print $2}')
    i=$(printf '%s' "$phase"  | grep -oE 'import [0-9.]+' | awk '{print $2}')
    te=$(printf '%s' "$phase" | grep -oE 'tests [0-9.]+' | awk '{print $2}')
    e=$(printf '%s' "$phase"  | grep -oE 'environment [0-9.]+' | awk '{print $2}')
    printf '{"suite":"integration","project":"%s","wall_seconds":%s,"transform":"%s","setup":"%s","import":"%s","tests":"%s","environment":"%s","exit":%s}\n' \
      "${PROJECT:-all}" "$wall" "${t:-}" "${s:-}" "${i:-}" "${te:-}" "${e:-}" "$rc"
  fi

  if [ "$rc" -ne 0 ]; then
    echo ""
    echo "  NOTE: run exited non-zero. Tail of log:" >&2
    tail -20 "$log" | strip_ansi >&2
  fi

  rm -f "$log"
  INTEG_WALL=$wall
  return $rc
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "Test-perf snapshot  ($repo_root)"
echo "===================================================="

best=""
i=1
while [ "$i" -le "$RUNS" ]; do
  if [ "$RUNS" -gt 1 ]; then
    echo ""
    echo "### Run $i of $RUNS"
  fi
  if [ "$MODE" = "unit" ]; then
    snapshot_unit
    this=${UNIT_WALL:-0}
  else
    snapshot_integration
    this=${INTEG_WALL:-0}
  fi
  if [ -z "$best" ] || [ "$this" -lt "$best" ]; then
    best=$this
  fi
  i=$((i + 1))
done

if [ "$RUNS" -gt 1 ]; then
  echo ""
  echo "Best wall clock across $RUNS runs: ${best}s"
fi
