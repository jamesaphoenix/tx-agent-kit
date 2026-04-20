#!/usr/bin/env bash
# Create a new git worktree and run setup.sh against it in one step.
# Runnable from the primary checkout OR from inside any existing worktree —
# we resolve the primary root via `git rev-parse --git-common-dir`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/colors.sh"
source "$SCRIPT_DIR/lib/validation.sh"

usage() {
  cat <<'USAGE'
Usage: ./scripts/worktree/create.sh <branch-name> [base-branch]

  branch-name  Full branch name to create (e.g. feat/tenancy-team-members).
               Worktree path is derived from the segment after the last `/`.
  base-branch  Branch to branch from. Defaults to `main`.

Examples:
  ./scripts/worktree/create.sh feat/tenancy-team-members
  ./scripts/worktree/create.sh fix/billing-refund main

The worktree is created at `<primary-root>/.worktrees/<derived-name>`, and
`setup.sh` is run against it automatically so the new worktree immediately
has port allocations, secrets seeded from the primary `.env`, and a
dedicated Postgres schema.

Do NOT run `git worktree add` directly — the `.claude/settings.json`
PreToolUse hook blocks raw `git worktree add` to guarantee setup runs.
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 0
fi

BRANCH="$1"
BASE_BRANCH="${2:-main}"

# Resolve primary checkout, regardless of where we're called from.
# `git rev-parse --git-common-dir` returns the primary's .git dir even when
# invoked from inside a secondary worktree.
if ! GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null)"; then
  log_error "Not inside a git repository."
  exit 1
fi

# Normalize to an absolute path, then take the parent (strip the trailing .git).
GIT_COMMON_DIR_ABS="$(cd "$GIT_COMMON_DIR" && pwd)"
PRIMARY_ROOT="$(cd "$GIT_COMMON_DIR_ABS/.." && pwd)"

if [[ ! -d "$PRIMARY_ROOT/.git" ]]; then
  log_error "Resolved primary root does not look like a git checkout: $PRIMARY_ROOT"
  exit 1
fi

# Derive the worktree directory name from the branch name.
# feat/tenancy-team-members -> tenancy-team-members
WORKTREE_NAME="${BRANCH##*/}"
if [[ -z "$WORKTREE_NAME" || "$WORKTREE_NAME" == "$BRANCH" && "$BRANCH" != *"/"* ]]; then
  # Branch had no `/` separator — just use the whole thing, but warn.
  WORKTREE_NAME="$BRANCH"
  log_warn "Branch '$BRANCH' has no type prefix (feat/fix/refactor/…). Using '$WORKTREE_NAME' as the worktree directory name."
fi

if ! validate_name "$WORKTREE_NAME" "worktree name"; then
  exit 1
fi

WORKTREE_PATH="$PRIMARY_ROOT/.worktrees/$WORKTREE_NAME"

if [[ -d "$WORKTREE_PATH" ]]; then
  log_error "Worktree path already exists: $WORKTREE_PATH"
  log_error "Remove it first with: git worktree remove $WORKTREE_PATH"
  exit 1
fi

# Verify the branch doesn't already exist — git would reject --new-branch anyway,
# but fail early with a clearer message.
if git -C "$PRIMARY_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  log_error "Branch already exists: $BRANCH"
  log_error "Use a different name, or check it out in a worktree with: git worktree add $WORKTREE_PATH $BRANCH"
  exit 1
fi

log_info "Creating worktree"
printf '  Primary root: %s\n' "$PRIMARY_ROOT"
printf '  Worktree path: %s\n' "$WORKTREE_PATH"
printf '  Branch: %s\n' "$BRANCH"
printf '  Base: %s\n' "$BASE_BRANCH"

mkdir -p "$PRIMARY_ROOT/.worktrees"

# We must invoke `git worktree add` here — the PreToolUse hook allows this
# script to do so because we are the sanctioned creation path.
git -C "$PRIMARY_ROOT" worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_BRANCH"

log_info "Running worktree setup"
"$SCRIPT_DIR/setup.sh" "$WORKTREE_PATH"

log_success "Worktree ready: $WORKTREE_PATH"
printf '\nNext steps:\n'
printf '  cd %s\n' "$WORKTREE_PATH"
printf '  pnpm dev       # or pnpm test:integration — both work in parallel with other worktrees\n'
