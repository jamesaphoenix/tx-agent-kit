#!/usr/bin/env bash

set -euo pipefail

SERVICE="${1:-}"

if [[ -z "$SERVICE" ]]; then
  echo "Usage: $0 <api|web|worker|docs>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if GIT_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)"; then
  REPO_ROOT="$GIT_ROOT"
fi

declare -a PIDS=()

has_pid() {
  local needle="$1"
  local pid

  (( ${#PIDS[@]} == 0 )) && return 1

  for pid in "${PIDS[@]}"; do
    [[ "$pid" == "$needle" ]] && return 0
  done

  return 1
}

add_pid() {
  local pid="$1"

  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  [[ "$pid" == "$$" ]] && return 0
  [[ "$pid" == "${PPID:-}" ]] && return 0

  if ! has_pid "$pid"; then
    PIDS+=("$pid")
  fi
}

pid_belongs_to_repo() {
  local pid="$1"
  local current="$pid"
  local depth=0

  while [[ "$current" =~ ^[0-9]+$ && "$current" != "0" && "$current" != "1" && $depth -lt 12 ]]; do
    local cwd=""
    local command=""
    local parent=""

    cwd="$(lsof -a -p "$current" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -n 1 || true)"
    command="$(ps -p "$current" -o command= 2>/dev/null || true)"

    if [[ "$cwd" == "$REPO_ROOT" || "$cwd" == "$REPO_ROOT/"* ]]; then
      return 0
    fi

    if [[ "$command" == *"$REPO_ROOT/"* ]]; then
      return 0
    fi

    parent="$(ps -p "$current" -o ppid= 2>/dev/null | tr -d ' ' || true)"
    [[ -n "$parent" && "$parent" != "$current" ]] || break
    current="$parent"
    depth=$((depth + 1))
  done

  return 1
}

collect_listeners() {
  local port="${1:-}"

  [[ -n "$port" ]] || return 0

  while IFS= read -r pid; do
    if pid_belongs_to_repo "$pid"; then
      add_pid "$pid"
    fi
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
}

collect_command_contains() {
  local required="$1"
  local optional="${2:-}"

  while IFS= read -r pid; do
    add_pid "$pid"
  done < <(
    ps -axo pid=,command= | while IFS= read -r line; do
      local pid="${line%% *}"
      local command="${line#* }"

      if [[ "$command" == *"$required"* ]]; then
        if [[ -z "$optional" || "$command" == *"$optional"* ]]; then
          printf '%s\n' "$pid"
        fi
      fi
    done
  )
}

# Reap a stale worker that is already polling THIS checkout's Temporal task queue,
# even if it lives in a different checkout/clone (the cause of worker version skew:
# a stale worker on the same queue fails any task it picks up). Workers register
# themselves in a queue-scoped pidfile on boot (see apps/worker/src/index.ts), so
# we only ever kill the previous holder of the SAME queue. Workers on a different
# queue (isolated worktrees, or unrelated projects) are never touched.
collect_worker_pidfile() {
  local queue="${TEMPORAL_TASK_QUEUE:-tx-agent-kit}"
  local sanitized
  sanitized="$(printf '%s' "$queue" | tr -c 'A-Za-z0-9_.-' '_')"
  local pidfile="${TMPDIR:-/tmp}/tx-agent-worker.${sanitized}.pid"

  [[ -f "$pidfile" ]] || return 0

  local old
  old="$(cat "$pidfile" 2>/dev/null || true)"
  [[ "$old" =~ ^[0-9]+$ ]] || return 0

  # Guard against a stale pidfile whose PID was recycled to an unrelated process:
  # only reap it if it is genuinely a worker.
  if ps -p "$old" -o command= 2>/dev/null | grep -q "apps/worker/src/index.ts"; then
    add_pid "$old"
  fi
}

case "$SERVICE" in
  api)
    collect_listeners "${API_PORT:-4000}"
    collect_command_contains "$REPO_ROOT/apps/api/src/server.ts"
    collect_command_contains "$REPO_ROOT/node_modules/.bin/../tsx/dist/cli.mjs" "watch src/server.ts"
    ;;
  web)
    collect_listeners "${WEB_PORT:-${PORT:-3000}}"
    ;;
  worker)
    collect_listeners "${WORKER_INSPECT_PORT:-9229}"
    collect_command_contains "$REPO_ROOT/apps/worker/src/index.ts"
    collect_command_contains "$REPO_ROOT/node_modules/.bin/../tsx/dist/cli.mjs" "watch src/index.ts"
    collect_worker_pidfile
    ;;
  docs)
    collect_listeners "${DOCS_PORT:-3002}"
    ;;
  *)
    echo "Unknown service '$SERVICE'. Expected api, web, worker, or docs." >&2
    exit 2
    ;;
esac

if (( ${#PIDS[@]} == 0 )); then
  exit 0
fi

kill "${PIDS[@]}" 2>/dev/null || true

for _ in 1 2 3 4 5; do
  any_alive="0"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      any_alive="1"
      break
    fi
  done

  [[ "$any_alive" == "0" ]] && break
  sleep 0.2
done

for pid in "${PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
done
