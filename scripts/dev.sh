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

DEV_CLOUDFLARE_TUNNEL_LOCK_DIR="${DEV_CLOUDFLARE_TUNNEL_LOCK_DIR:-/tmp/tx-agent-kit-dev-tunnel.lock}"
DEV_CLOUDFLARE_TUNNEL_STALE_TIMEOUT_SECONDS="${DEV_CLOUDFLARE_TUNNEL_STALE_TIMEOUT_SECONDS:-120}"
DEV_CLOUDFLARE_TUNNEL_MISSING_PID_GRACE_SECONDS="${DEV_CLOUDFLARE_TUNNEL_MISSING_PID_GRACE_SECONDS:-15}"

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_non_negative_integer() {
  local name="$1"
  local value="$2"

  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "$name must be a non-negative integer (received: $value)."
    exit 1
  fi
}

CLOUDFLARED_PID=""
TUNNEL_LOCK_OWNED="0"

require_non_negative_integer "DEV_CLOUDFLARE_TUNNEL_STALE_TIMEOUT_SECONDS" "$DEV_CLOUDFLARE_TUNNEL_STALE_TIMEOUT_SECONDS"
require_non_negative_integer "DEV_CLOUDFLARE_TUNNEL_MISSING_PID_GRACE_SECONDS" "$DEV_CLOUDFLARE_TUNNEL_MISSING_PID_GRACE_SECONDS"

metadata_value() {
  local metadata_file="$1"
  local key="$2"
  grep -E "^${key}=" "$metadata_file" 2>/dev/null | head -n 1 | cut -d= -f2- || true
}

print_existing_tunnel_owner() {
  local owner_file="${DEV_CLOUDFLARE_TUNNEL_LOCK_DIR}/owner.meta"
  if [[ ! -f "$owner_file" ]]; then
    echo "Cloudflare dev tunnel already owned by another process (owner metadata unavailable)."
    return
  fi

  local owner_pid
  local owner_worktree
  local owner_started_at
  local owner_mode
  owner_pid="$(metadata_value "$owner_file" "PID")"
  owner_worktree="$(metadata_value "$owner_file" "WORKTREE_PATH")"
  owner_started_at="$(metadata_value "$owner_file" "STARTED_AT_EPOCH")"
  owner_mode="$(metadata_value "$owner_file" "MODE")"

  echo "Cloudflare dev tunnel already owned by another process; skipping tunnel startup in this worktree."
  [[ -n "$owner_pid" ]] && echo "  Owner PID: ${owner_pid}"
  [[ -n "$owner_worktree" ]] && echo "  Owner worktree: ${owner_worktree}"
  [[ -n "$owner_started_at" ]] && echo "  Started at (epoch): ${owner_started_at}"
  [[ -n "$owner_mode" ]] && echo "  Mode: ${owner_mode}"
}

write_tunnel_owner_metadata() {
  local mode="$1"
  local api_port="$2"
  local log_file="$3"
  local tunnel_url="$4"
  local owner_file="${DEV_CLOUDFLARE_TUNNEL_LOCK_DIR}/owner.meta"

  cat > "$owner_file" <<EOF
PID=$$
WORKTREE_PATH=$PROJECT_ROOT
API_PORT=$api_port
MODE=$mode
STARTED_AT_EPOCH=$(date +%s)
LOG_FILE=$log_file
TUNNEL_URL=$tunnel_url
EOF
}

try_acquire_tunnel_lock() {
  if mkdir "$DEV_CLOUDFLARE_TUNNEL_LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "${DEV_CLOUDFLARE_TUNNEL_LOCK_DIR}/pid"
    TUNNEL_LOCK_OWNED="1"
    return 0
  fi

  lock_try_reap_stale \
    "$DEV_CLOUDFLARE_TUNNEL_LOCK_DIR" \
    "$DEV_CLOUDFLARE_TUNNEL_STALE_TIMEOUT_SECONDS" \
    "$DEV_CLOUDFLARE_TUNNEL_MISSING_PID_GRACE_SECONDS" || true

  if mkdir "$DEV_CLOUDFLARE_TUNNEL_LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "${DEV_CLOUDFLARE_TUNNEL_LOCK_DIR}/pid"
    TUNNEL_LOCK_OWNED="1"
    return 0
  fi

  return 1
}

stop_cloudflare_tunnel() {
  if [[ -z "$CLOUDFLARED_PID" ]]; then
    return
  fi

  if kill -0 "$CLOUDFLARED_PID" >/dev/null 2>&1; then
    kill "$CLOUDFLARED_PID" >/dev/null 2>&1 || true
    wait "$CLOUDFLARED_PID" >/dev/null 2>&1 || true
  fi
}

release_tunnel_lock_if_owned() {
  if [[ "$TUNNEL_LOCK_OWNED" != "1" ]]; then
    return
  fi

  rm -f "${DEV_CLOUDFLARE_TUNNEL_LOCK_DIR}/owner.meta" >/dev/null 2>&1 || true
  lock_release "$DEV_CLOUDFLARE_TUNNEL_LOCK_DIR" || true
  TUNNEL_LOCK_OWNED="0"
}

cleanup() {
  stop_cloudflare_tunnel
  release_tunnel_lock_if_owned
}

trap cleanup EXIT INT TERM

start_cloudflare_tunnel_if_enabled() {
  if ! is_truthy "${DEV_CLOUDFLARE_TUNNEL_ENABLED:-false}"; then
    return
  fi

  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "DEV_CLOUDFLARE_TUNNEL_ENABLED is true but cloudflared is not installed."
    exit 1
  fi

  if ! try_acquire_tunnel_lock; then
    print_existing_tunnel_owner
    return
  fi

  local api_port="${API_PORT:-4000}"
  local tunnel_url="${DEV_CLOUDFLARE_TUNNEL_URL:-http://127.0.0.1:${api_port}}"
  local log_file="${DEV_CLOUDFLARE_TUNNEL_LOG_FILE:-.data/cloudflared/dev-tunnel.log}"
  local mode="url"

  mkdir -p "$(dirname "$log_file")"
  : > "$log_file"

  local -a cloudflared_cmd
  cloudflared_cmd=("cloudflared" "tunnel" "--no-autoupdate")

  if [[ -n "${DEV_CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
    mode="named"
    cloudflared_cmd+=("run" "--token" "$DEV_CLOUDFLARE_TUNNEL_TOKEN")
  else
    cloudflared_cmd+=("--url" "$tunnel_url")
  fi

  echo "Starting Cloudflare dev tunnel..."
  "${cloudflared_cmd[@]}" >>"$log_file" 2>&1 &
  CLOUDFLARED_PID="$!"

  sleep 1
  if ! kill -0 "$CLOUDFLARED_PID" >/dev/null 2>&1; then
    echo "Cloudflare tunnel failed to start. Check logs: $log_file"
    tail -n 20 "$log_file" || true
    release_tunnel_lock_if_owned
    exit 1
  fi

  if [[ "$mode" == "url" ]]; then
    local public_url=""
    local attempt=0

    while (( attempt < 20 )); do
      attempt=$((attempt + 1))
      public_url="$(grep -Eo 'https://[-a-z0-9]+\\.trycloudflare\\.com' "$log_file" | tail -n 1 || true)"
      if [[ -n "$public_url" ]]; then
        break
      fi
      sleep 1
    done

    if [[ -n "$public_url" ]]; then
      write_tunnel_owner_metadata "$mode" "$api_port" "$log_file" "$public_url"
      echo "Cloudflare dev tunnel URL: $public_url"
    else
      write_tunnel_owner_metadata "$mode" "$api_port" "$log_file" "$tunnel_url"
      echo "Cloudflare dev tunnel started. Check logs for URL: $log_file"
    fi
  else
    write_tunnel_owner_metadata "$mode" "$api_port" "$log_file" ""
    echo "Cloudflare named tunnel started."
  fi
}

pnpm infra:ensure
pnpm temporal:dev:up
start_cloudflare_tunnel_if_enabled
turbo run dev --parallel
