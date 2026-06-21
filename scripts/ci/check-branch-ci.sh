#!/usr/bin/env bash
# Post-push full-suite CI gate.
#
# Local default integration runs are AFFECTED-ONLY for fast feedback (see
# scripts/test-integration-quiet.sh), so cross-package or CI-only breakage does
# NOT surface locally - tests share a DB schema and a per-worktree API server,
# and turbo's static graph cannot see that runtime coupling. CI ALWAYS runs the
# full suite. This helper makes an agent LOOK at that full-suite result on its
# own branch after pushing, and surfaces any contradiction across the whole
# suite before the work is considered done.
#
# Usage:
#   scripts/ci/check-branch-ci.sh [--watch] [--branch <branch>] [--sha <sha>]
#   pnpm ci:check            # snapshot of the CI runs for the current HEAD
#   pnpm ci:check --watch    # poll until the runs for HEAD conclude (run it
#                            # backgrounded; it can take many minutes)
#
# Exit codes:
#   0  every CI run for the commit concluded success
#   1  at least one CI run for the commit failed (or, with --watch, timed out)
#   2  no CI runs found yet for the commit (the push may not have registered)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

WATCH=0
BRANCH=""
SHA=""
POLL_SECONDS="${CI_CHECK_POLL_SECONDS:-20}"
MAX_POLLS="${CI_CHECK_MAX_POLLS:-135}" # ~45 min at 20s
# The full-suite gate must be present + passed before we declare green. Fast
# checks (Lockfile) finish first and register before the heavy integration
# workflow, so greenlighting on them alone would miss the actual suite. Default
# matches the repo's full-suite workflow; set empty to disable.
REQUIRED_WORKFLOW_PATTERN="${CI_CHECK_REQUIRED_WORKFLOW-Integration Tests}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch) WATCH=1; shift ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found; cannot check branch CI."
  exit 1
fi

if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi
if [[ -z "$SHA" ]]; then
  SHA="$(git rev-parse HEAD)"
fi

echo "Full-suite CI check for branch '$BRANCH' @ ${SHA:0:9}"
echo "(local runs are affected-only; CI runs the FULL suite - this is the soundness net)"

# TSV rows for runs whose head commit is exactly $SHA:
#   <status>\t<conclusion>\t<workflowName>\t<databaseId>
fetch_runs_tsv() {
  gh run list --branch "$BRANCH" --limit 40 \
    --json databaseId,headSha,status,conclusion,workflowName \
    --jq ".[] | select(.headSha == \"$SHA\") | [.status, (.conclusion // \"-\"), .workflowName, (.databaseId|tostring)] | @tsv" \
    2>/dev/null || true
}

all_completed() {
  local rows="$1"
  [[ -z "$rows" ]] && return 1
  # Incomplete if any row's status is not "completed".
  if printf '%s\n' "$rows" | awk -F '\t' '$1 != "completed" { found = 1 } END { exit found ? 0 : 1 }'; then
    return 1
  fi
  return 0
}

# The full-suite workflow must be PRESENT and COMPLETED. Returns 0 only then;
# 1 if it is absent or still running (so we keep waiting rather than greenlight
# on the fast checks that register first). Always satisfied when no pattern set.
required_workflow_ready() {
  local rows="$1"
  [[ -z "$REQUIRED_WORKFLOW_PATTERN" ]] && return 0
  printf '%s\n' "$rows" | awk -F '\t' -v pat="$REQUIRED_WORKFLOW_PATTERN" '
    index($3, pat) > 0 { seen = 1; if ($1 == "completed") done = 1 }
    END { exit (seen && done) ? 0 : 1 }
  '
}

# True once every present run is completed AND the required full-suite run is
# present + completed.
ready_to_judge() {
  local rows="$1"
  all_completed "$rows" && required_workflow_ready "$rows"
}

ROWS="$(fetch_runs_tsv)"

if [[ "$WATCH" == "1" ]]; then
  polls=0
  while ! ready_to_judge "$ROWS"; do
    if [[ -z "$ROWS" ]]; then
      echo "  no CI runs registered for ${SHA:0:9} yet; waiting..."
    elif ! required_workflow_ready "$ROWS"; then
      echo "  waiting for the full-suite run ('$REQUIRED_WORKFLOW_PATTERN') to register/finish..."
    else
      pending="$(printf '%s\n' "$ROWS" | awk -F '\t' '$1 != "completed" { print "    " $1 "  " $3 }')"
      echo "  in progress:"
      printf '%s\n' "$pending"
    fi
    polls=$((polls + 1))
    if [[ "$polls" -ge "$MAX_POLLS" ]]; then
      echo "Timed out waiting for CI to conclude after $((MAX_POLLS * POLL_SECONDS))s."
      exit 1
    fi
    sleep "$POLL_SECONDS"
    ROWS="$(fetch_runs_tsv)"
  done
fi

if [[ -z "$ROWS" ]]; then
  echo "No CI runs found yet for ${SHA:0:9}. Has the branch been pushed? Re-run shortly (or with --watch)."
  exit 2
fi

echo "============================================================"
echo "CI runs for ${SHA:0:9}:"
FAILED=0
INCOMPLETE=0
while IFS=$'\t' read -r run_status conclusion workflow run_id; do
  [[ -z "$run_id" ]] && continue
  if [[ "$run_status" != "completed" ]]; then
    echo "  PENDING   $workflow ($run_status)"
    INCOMPLETE=1
    continue
  fi
  if [[ "$conclusion" == "success" ]]; then
    echo "  ok        $workflow"
  elif [[ "$conclusion" == "skipped" ]]; then
    echo "  skipped   $workflow"
  else
    echo "  FAILED    $workflow ($conclusion)"
    FAILED=1
    # Surface the failing jobs so the contradiction is actionable.
    gh run view "$run_id" --json jobs \
      --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != null) | "              job: \(.name) (\(.conclusion))"' \
      2>/dev/null || true
  fi
done <<< "$ROWS"
echo "============================================================"

if [[ "$FAILED" == "1" ]]; then
  echo "FULL-SUITE CI FAILED on this branch. Affected-only local runs can miss"
  echo "cross-package breakage - investigate the failing job(s) above before"
  echo "considering this work done."
  exit 1
fi

if [[ "$INCOMPLETE" == "1" ]]; then
  echo "CI still in progress. Re-run with --watch to block until it concludes."
  exit 2
fi

# Guard against greenlighting on fast checks alone: the full-suite workflow must
# have registered AND passed. If it is absent, the heavy run has not been picked
# up yet (it registers after the quick checks) - do NOT report green.
if ! required_workflow_ready "$ROWS"; then
  echo "The full-suite run ('$REQUIRED_WORKFLOW_PATTERN') has not registered/finished for"
  echo "${SHA:0:9} yet - the fast checks complete first. Re-run with --watch (or shortly)."
  exit 2
fi

echo "Full-suite CI is GREEN on this branch."
exit 0
