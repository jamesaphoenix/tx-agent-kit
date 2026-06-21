#!/usr/bin/env bash
# Shared helpers for the LOCAL affected-only test runners
# (scripts/test-affected.sh and scripts/test-integration-affected.sh).
#
# These helpers exist ONLY to let local devs run a smaller, affected subset of
# the test suite. CI always runs the full suite via the default
# `pnpm test` / `pnpm test:integration` entrypoints - nothing here changes that.
#
# Correctness posture (mirrors scripts/lint-ci.sh): on ANY ambiguity we FALL
# BACK TO FULL rather than silently skip tests.

set -euo pipefail

# Sentinel paths whose change must force a FULL run. A change to any of these
# can affect every package/test in ways turbo's package-graph affected analysis
# does not fully capture (shared test harness, tooling configs, generated API
# contract, workspace/lockfile topology). turbo.json globalDependencies already
# encodes several of these for hashing; we keep an explicit belt-and-braces
# allowlist here so the affected runners err on the side of running more.
AFFECTED_SENTINEL_PATHS=(
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "package.json"
  "turbo.json"
  "vitest.integration.workspace.ts"
  "packages/tooling/vitest-config"
  "packages/infra/db"
  "packages/testkit"
  "scripts/test"
  "scripts/lib"
  "apps/api/openapi.json"
)

# Resolve the base ref to diff against.
#   Priority: explicit positional arg > TX_INTEGRATION_BASE_REF env > origin/main.
# Normalizes bare branch names to origin/<name> and treats an all-zero SHA
# (GitHub's "no base" sentinel) as empty. Echoes the resolved ref (possibly
# empty when nothing comparable exists).
resolve_affected_base_ref() {
  local explicit_ref="${1:-}"
  local base_ref

  if [[ -n "$explicit_ref" ]]; then
    base_ref="$explicit_ref"
  elif [[ -n "${TX_INTEGRATION_BASE_REF:-}" ]]; then
    base_ref="${TX_INTEGRATION_BASE_REF}"
  else
    base_ref="origin/main"
  fi

  # GitHub passes 0000000000000000000000000000000000000000 when there is no base.
  if [[ -n "$base_ref" && "$base_ref" =~ ^0+$ ]]; then
    base_ref=""
  fi

  # Normalize bare branch names (e.g. "main") to a remote-tracking ref so the
  # diff is stable regardless of the local branch checkout state. Leave full
  # SHAs, origin/* refs, HEAD-relative refs, and tags alone.
  if [[ -n "$base_ref" &&
    ! "$base_ref" =~ ^[0-9a-f]{7,40}$ &&
    "$base_ref" != origin/* &&
    "$base_ref" != HEAD* &&
    "$base_ref" != refs/* ]]; then
    base_ref="origin/$base_ref"
  fi

  printf '%s\n' "$base_ref"
}

# Returns 0 (true) when the base ref is usable for an affected computation.
# Returns 1 (false) on empty ref or a ref git cannot resolve (detached/missing).
affected_base_ref_is_usable() {
  local base_ref="$1"
  if [[ -z "$base_ref" ]]; then
    return 1
  fi
  if ! git rev-parse --verify --quiet "$base_ref" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

# Echoes any changed sentinel paths between the base ref and the current working
# tree (one per line). Empty output means no sentinel changed. Assumes the base
# ref is usable.
#
# We intentionally diff the WORKING TREE against the base ref (two-dot
# `git diff <ref>`), NOT the committed-only merge-base diff (`<ref>...HEAD`).
# turbo's `--filter=...[<ref>]` affected analysis considers uncommitted
# working-tree changes, so for a LOCAL runner the sentinel check must see them
# too - otherwise an uncommitted edit to a sentinel (e.g. pnpm-lock.yaml) would
# slip through and we would run a too-narrow affected set. Two-dot also still
# includes everything committed since the base, so it is a strict superset and
# always errs toward forcing FULL.
changed_sentinel_paths() {
  local base_ref="$1"
  git diff --name-only "$base_ref" -- "${AFFECTED_SENTINEL_PATHS[@]}"
}

# Single source of truth for the affected INTEGRATION decision, shared by the
# affected helper (scripts/test-integration-affected.sh) and the non-quiet
# runner (scripts/test/run-integration.sh) so both make the SAME choice.
#
# Resolves the base ref, then on ANY ambiguity (no usable ref, sentinel change,
# turbo/JSON failure) prints the sentinel `FULL` and a human reason on stderr.
# Otherwise prints a deduplicated, sorted CSV of affected integration project
# IDs that ALWAYS includes the core `api` project.
#
# Args: $1 = explicit base ref (may be empty; falls back to env/origin/main),
#       $2 = absolute path to scripts/lib (to locate the node helper).
# Stdout: either `FULL` or a project CSV (e.g. `api,web`).
# Stderr: a one-line "<reason>" suitable for the caller's banner.
FULL_INTEGRATION_SENTINEL="FULL"

resolve_affected_integration_decision() {
  local explicit_ref="${1:-}"
  local lib_dir="$2"
  local base_ref
  base_ref="$(resolve_affected_base_ref "$explicit_ref")"

  if ! affected_base_ref_is_usable "$base_ref"; then
    printf 'no usable base ref (resolved=%s)\n' "${base_ref:-<empty>}" >&2
    printf '%s\n' "$FULL_INTEGRATION_SENTINEL"
    return 0
  fi

  local sentinel_changes
  sentinel_changes="$(changed_sentinel_paths "$base_ref")"
  if [[ -n "$sentinel_changes" ]]; then
    printf 'sentinel inputs changed since %s\n' "$base_ref" >&2
    printf '%s\n' "$FULL_INTEGRATION_SENTINEL"
    return 0
  fi

  local affected_projects affected_exit
  set +e
  affected_projects="$(node "$lib_dir/affected-integration-projects.mjs" "$base_ref")"
  affected_exit=$?
  set -e
  if [[ "$affected_exit" -ne 0 ]]; then
    printf 'could not compute affected integration projects (turbo/JSON ambiguity)\n' >&2
    printf '%s\n' "$FULL_INTEGRATION_SENTINEL"
    return 0
  fi

  local projects_csv
  projects_csv="$(
    {
      printf 'api\n'
      printf '%s' "$affected_projects" | tr ',' '\n'
    } | sed '/^$/d' | sort -u | paste -sd, -
  )"

  if [[ -z "$projects_csv" ]]; then
    printf 'affected project set resolved empty\n' >&2
    printf '%s\n' "$FULL_INTEGRATION_SENTINEL"
    return 0
  fi

  printf 'affected since %s\n' "$base_ref" >&2
  printf '%s\n' "$projects_csv"
}
