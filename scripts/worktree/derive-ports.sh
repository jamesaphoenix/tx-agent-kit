#!/usr/bin/env bash
# Deterministic, collision-aware port assignment for worktrees.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$SCRIPT_DIR/lib/ports.sh"
source "$SCRIPT_DIR/lib/validation.sh"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <worktree-name>"
  exit 1
fi

WORKTREE_NAME="$1"
if ! validate_name "$WORKTREE_NAME" "worktree name"; then
  exit 1
fi

ACTIVE_WORKTREE_NAMES=()
while IFS= read -r worktree_path; do
  worktree_base_name="$(basename "$worktree_path")"
  if [[ -n "$worktree_base_name" ]]; then
    ACTIVE_WORKTREE_NAMES+=("$worktree_base_name")
  fi
done < <(git -C "$ROOT_DIR" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')

if [[ ${#ACTIVE_WORKTREE_NAMES[@]} -gt 0 ]]; then
  echo "WORKTREE_NAME=$WORKTREE_NAME"
  allocate_worktree_ports "$WORKTREE_NAME" "${ACTIVE_WORKTREE_NAMES[@]}"
else
  echo "WORKTREE_NAME=$WORKTREE_NAME"
  allocate_worktree_ports "$WORKTREE_NAME"
fi
