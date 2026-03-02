#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

source "$SCRIPT_DIR/lib/lock.sh"

if [[ -f ./.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

LOCK_DIR="${DEV_CLOUDFLARE_TUNNEL_LOCK_DIR:-/tmp/tx-agent-kit-dev-tunnel.lock}"
OWNER_FILE="${LOCK_DIR}/owner.meta"
PID_FILE="${LOCK_DIR}/pid"

metadata_value() {
  local metadata_file="$1"
  local key="$2"
  grep -E "^${key}=" "$metadata_file" 2>/dev/null | head -n 1 | cut -d= -f2- || true
}

if [[ ! -d "$LOCK_DIR" ]]; then
  echo "status=unlocked"
  echo "lock_dir=$LOCK_DIR"
  exit 0
fi

status="unknown"
owner_pid=""

if [[ -f "$PID_FILE" ]]; then
  owner_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$owner_pid" ]] && kill -0 "$owner_pid" >/dev/null 2>&1; then
    status="active"
  else
    status="stale"
  fi
else
  lock_mtime="$(get_file_mtime_epoch "$LOCK_DIR" || true)"
  if [[ -n "$lock_mtime" ]]; then
    age_seconds=$(( $(date +%s) - lock_mtime ))
    if (( age_seconds >= ${DEV_CLOUDFLARE_TUNNEL_MISSING_PID_GRACE_SECONDS:-15} )); then
      status="stale"
    fi
  fi
fi

echo "status=$status"
echo "lock_dir=$LOCK_DIR"
[[ -n "$owner_pid" ]] && echo "pid=$owner_pid"

if [[ -f "$OWNER_FILE" ]]; then
  worktree_path="$(metadata_value "$OWNER_FILE" "WORKTREE_PATH")"
  started_at_epoch="$(metadata_value "$OWNER_FILE" "STARTED_AT_EPOCH")"
  api_port="$(metadata_value "$OWNER_FILE" "API_PORT")"
  mode="$(metadata_value "$OWNER_FILE" "MODE")"
  tunnel_url="$(metadata_value "$OWNER_FILE" "TUNNEL_URL")"
  log_file="$(metadata_value "$OWNER_FILE" "LOG_FILE")"

  [[ -n "$worktree_path" ]] && echo "worktree_path=$worktree_path"
  [[ -n "$started_at_epoch" ]] && echo "started_at_epoch=$started_at_epoch"
  [[ -n "$api_port" ]] && echo "api_port=$api_port"
  [[ -n "$mode" ]] && echo "mode=$mode"
  [[ -n "$tunnel_url" ]] && echo "tunnel_url=$tunnel_url"
  [[ -n "$log_file" ]] && echo "log_file=$log_file"
fi
