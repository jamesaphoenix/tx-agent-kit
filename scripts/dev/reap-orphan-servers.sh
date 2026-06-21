#!/usr/bin/env bash
# Reap orphaned dev/integration servers: node (api/worker/web) processes that
# were spawned inside a git worktree whose directory NO LONGER EXISTS.
#
# When a worktree goes away (git worktree remove/prune, kill -9, or a crash that
# skips dev.sh's EXIT trap), the servers it spawned keep running - holding ports
# and polling the shared Postgres/Temporal/Redis, which loads the Docker VM and
# spins the fans. scripts/worktree/manage.sh reaps on a clean removal; this is
# the safety net for the cases that escape it. Killing is always safe here: a
# process whose worktree directory is gone cannot be in use by anyone.
#
# Usage:
#   scripts/dev/reap-orphan-servers.sh            # reap (SIGTERM then SIGKILL)
#   scripts/dev/reap-orphan-servers.sh --dry-run  # list only, kill nothing
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# Collect pids whose cwd is inside this repo's worktree checkout that no longer
# exists on disk. One lsof pass over cwd file descriptors (cheap); track the
# current pid across the -F field lines (p<pid> then n<cwd>).
orphan_pids=""
current_pid=""
while IFS= read -r line; do
  case "$line" in
    p*) current_pid="${line#p}" ;;
    n*)
      cwd="${line#n}"
      # Only worktree checkouts (.worktrees or .claude/worktrees).
      case "$cwd" in
        */.worktrees/*|*/.claude/worktrees/*) ;;
        *) continue ;;
      esac
      # An orphan is one whose worktree directory is gone. A live worktree's cwd
      # still resolves, so it is skipped.
      [[ -d "$cwd" ]] && continue
      # Only dev/integration server runtimes - never a shell, editor, or git.
      cmd="$(ps -p "$current_pid" -o command= 2>/dev/null || true)"
      case "$cmd" in
        *node*|*tsx*|*next*|*esbuild*)
          orphan_pids="$orphan_pids $current_pid"
          echo "  orphan: pid=$current_pid  cwd=$cwd"
          ;;
      esac
      ;;
  esac
done < <(lsof -d cwd -Fpn 2>/dev/null || true)

# Deduplicate (a process can surface more than once).
orphan_pids="$(printf '%s\n' $orphan_pids | sed '/^$/d' | sort -u | tr '\n' ' ')"

if [[ -z "${orphan_pids// /}" ]]; then
  echo "No orphaned dev servers (every dev/integration server belongs to a live worktree)."
  exit 0
fi

count="$(printf '%s\n' $orphan_pids | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] would reap $count orphaned dev server(s)."
  exit 0
fi

echo "Reaping $count orphaned dev server(s)..."
# shellcheck disable=SC2086 # intentional word-splitting of the pid list
kill $orphan_pids 2>/dev/null || true
sleep 1
for pid in $orphan_pids; do
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
done
echo "Done."
