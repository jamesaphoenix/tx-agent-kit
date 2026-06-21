#!/usr/bin/env bash
# Test census for this repo: count tracked test files by TYPE, not by name alone.
#
# Classifies every tracked test file into exactly one bucket using content
# heuristics applied in precedence order (e2e > react-component > integration >
# unit), so the buckets are mutually exclusive. pgTAP DB-contract tests are a
# distinct kind (.sql, not picked up by `git ls-files` of the JS/TS test
# globs) and are reported as a separate `db` bucket.
#
# macOS bash 3.2 compatible: no `mapfile`/`readarray`; all iteration uses
# `while IFS= read -r` loops.
#
# Usage:
#   count.sh                      # summary table: total + per-category counts + %
#   count.sh --by-dir             # summary + per-top-level-area breakdown
#   count.sh --files <category>   # list files in a bucket: unit|integration|react-component|e2e|db
#   --no-repos                    # (any position) drop the vendored repos/ tree from all counts

set -u

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root" || exit 1

# Strip --no-repos out of the positional args so the existing flag parsing is unaffected.
NO_REPOS=0
args=()
for a in "$@"; do
  if [ "$a" = "--no-repos" ]; then NO_REPOS=1; else args+=("$a"); fi
done
set -- "${args[@]+"${args[@]}"}"

# --- file scope -------------------------------------------------------------
# Tracked test files matching the JS/TS test globs, minus build/output dirs.
# pgTAP (.sql) is collected separately below.
TEST_GLOBS=( '*.test.ts' '*.test.tsx' '*.test.mjs' '*.test.js' '*.spec.ts' '*.spec.tsx' )
DROP_RE='(^|/)(node_modules|dist|\.next|coverage|build|\.turbo|\.vercel)/'

ALL=$(git ls-files "${TEST_GLOBS[@]}" | grep -vE "$DROP_RE" || true)
if [ "$NO_REPOS" -eq 1 ]; then
  ALL=$(printf '%s\n' "$ALL" | grep -vE '^repos/' || true)
fi
ALL=$(printf '%s\n' "$ALL" | grep -v '^$' || true)

# pgTAP DB-contract tests (.sql under a pgtap/ dir). Vendored repos never have
# these, so --no-repos does not affect the db bucket.
PGTAP=$(git ls-files '*/pgtap/*.sql' 'pgtap/*.sql' | grep -vE "$DROP_RE" | grep -v '^$' || true)

# --- content signals --------------------------------------------------------
# e2e: under an e2e/ dir, or *.e2e.test.* / *.e2e.spec.* filename, or imports
#      a real browser driver. NOTE: backend *.e2e.integration.test.ts files are
#      node/vitest workflow tests (no playwright, not under e2e/), so they do
#      NOT match here and fall through to the integration bucket below.
E2E_PATH_RE='(^|/)e2e/|\.e2e\.(test|spec)\.[A-Za-z]+$'
E2E_IMPORT_RE="@playwright/test|from ['\"]playwright['\"]|require\(['\"]playwright['\"]\)"

# react-component: renders React in jsdom. Direct testing-library import,
# react-test-renderer (mobile), the repo render helpers, or an import from the
# local integration/test-utils module (which re-exports @testing-library/react).
REACT_RE="@testing-library/react|@testing-library/react-native|react-test-renderer|renderWithProviders|renderTeamScopedPage|integration/test-utils"

INTEGRATION_NAME_RE='\.integration\.(test|spec)\.[A-Za-z]+$'

# is_e2e / is_react read file content; cheap enough for ~1k files.
is_e2e() {
  case "$1" in
    *) printf '%s\n' "$1" | grep -qE "$E2E_PATH_RE" && return 0 ;;
  esac
  grep -lE "$E2E_IMPORT_RE" "$1" >/dev/null 2>&1
}
is_react() { grep -lE "$REACT_RE" "$1" >/dev/null 2>&1; }
is_integration_name() { printf '%s\n' "$1" | grep -qE "$INTEGRATION_NAME_RE"; }

# classify one path -> echoes the bucket name (precedence: e2e > react > integration > unit)
classify() {
  local f="$1"
  if is_e2e "$f"; then echo e2e; return; fi
  if is_react "$f"; then echo react-component; return; fi
  if is_integration_name "$f"; then echo integration; return; fi
  echo unit
}

# --- partition into buckets (one pass) --------------------------------------
UNIT_FILES=""
INTEGRATION_FILES=""
REACT_FILES=""
E2E_FILES=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$(classify "$f")" in
    e2e)             E2E_FILES="$E2E_FILES$f"$'\n' ;;
    react-component) REACT_FILES="$REACT_FILES$f"$'\n' ;;
    integration)     INTEGRATION_FILES="$INTEGRATION_FILES$f"$'\n' ;;
    unit)            UNIT_FILES="$UNIT_FILES$f"$'\n' ;;
  esac
done <<EOF
$ALL
EOF

count() { printf '%s\n' "$1" | grep -c . || true; }

unit_n=$(count "$UNIT_FILES")
integration_n=$(count "$INTEGRATION_FILES")
react_n=$(count "$REACT_FILES")
e2e_n=$(count "$E2E_FILES")
db_n=$(count "$PGTAP")
total_n=$((unit_n + integration_n + react_n + e2e_n))

pct() {
  # pct <part> <whole>  -> e.g. "12.3%"
  if [ "${2:-0}" -eq 0 ]; then echo "0.0%"; return; fi
  awk -v p="$1" -v w="$2" 'BEGIN { printf "%.1f%%", (p*100.0)/w }'
}

# --- --files <category> ------------------------------------------------------
if [ "${1:-}" = "--files" ]; then
  case "${2:-}" in
    unit)            printf '%s' "$UNIT_FILES" ;;
    integration)     printf '%s' "$INTEGRATION_FILES" ;;
    react-component) printf '%s' "$REACT_FILES" ;;
    e2e)             printf '%s' "$E2E_FILES" ;;
    db)              printf '%s\n' "$PGTAP" | grep -v '^$' || true ;;
    *) echo "usage: count.sh --files (unit|integration|react-component|e2e|db)" >&2; exit 2 ;;
  esac
  exit 0
fi

# --- summary table ----------------------------------------------------------
printf 'Test Census  (%s)\n' "$repo_root"
printf '%s\n' '------------------------------------------------------------'
printf '  unit:               %6d   %7s\n' "$unit_n"        "$(pct "$unit_n" "$total_n")"
printf '  integration:        %6d   %7s\n' "$integration_n" "$(pct "$integration_n" "$total_n")"
printf '  react-component:    %6d   %7s\n' "$react_n"       "$(pct "$react_n" "$total_n")"
printf '  e2e:                %6d   %7s\n' "$e2e_n"         "$(pct "$e2e_n" "$total_n")"
printf '  ----                ------\n'
printf '  Total test files:   %6d\n' "$total_n"
printf '\n  Separate (not in total above):\n'
printf '    db (pgtap):       %6d   (*.sql DB-contract tests under pgtap/)\n' "$db_n"
if [ "$NO_REPOS" -eq 0 ]; then
  repos_n=$(printf '%s\n' "$ALL" | grep -cE '^repos/' || true)
  printf '\n  Note: includes %d vendored test files under repos/. Use --no-repos to drop them.\n' "$repos_n"
fi

# --- --by-dir ---------------------------------------------------------------
if [ "${1:-}" = "--by-dir" ]; then
  printf '\nPer top-level area (unit / integration / react-component / e2e):\n'
  printf '%s\n' '------------------------------------------------------------'
  bucket_for() {
    awk -F/ '{
      if ($1=="apps" || $1=="packages") print $1"/"$2;
      else if (NF >= 2) print $1;
      else print $1;
    }'
  }
  areas=$(printf '%s\n' "$UNIT_FILES" "$INTEGRATION_FILES" "$REACT_FILES" "$E2E_FILES" \
          | grep -v '^$' | bucket_for | sort -u)
  while IFS= read -r area; do
    [ -z "$area" ] && continue
    u=$(printf '%s\n' "$UNIT_FILES"        | grep -cE "^${area}(/|\$)" || true)
    i=$(printf '%s\n' "$INTEGRATION_FILES" | grep -cE "^${area}(/|\$)" || true)
    r=$(printf '%s\n' "$REACT_FILES"       | grep -cE "^${area}(/|\$)" || true)
    e=$(printf '%s\n' "$E2E_FILES"         | grep -cE "^${area}(/|\$)" || true)
    sum=$((u + i + r + e))
    [ "$sum" -eq 0 ] && continue
    printf '  %-26s  unit %5d   int %5d   react %5d   e2e %4d\n' "$area" "$u" "$i" "$r" "$e"
  done <<EOF
$areas
EOF
fi
