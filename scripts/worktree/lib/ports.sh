#!/usr/bin/env bash
set -euo pipefail

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_LIB_DIR/colors.sh"

DEFAULT_WEB_BASE_PORT=3000
DEFAULT_API_BASE_PORT=4000
DEFAULT_MOBILE_BASE_PORT=8081
DEFAULT_WORKER_INSPECT_BASE_PORT=9229
DEFAULT_GRAFANA_BASE_PORT=3001
DEFAULT_PROMETHEUS_BASE_PORT=9090
PORT_OFFSET_MIN=100
PORT_OFFSET_MAX=1099
PORT_OFFSET_CACHE_NAMES=()
PORT_OFFSET_CACHE_VALUES=()

lookup_cached_port_offset() {
  local worktree_name="$1"
  local cache_index

  for cache_index in "${!PORT_OFFSET_CACHE_NAMES[@]}"; do
    if [[ "${PORT_OFFSET_CACHE_NAMES[$cache_index]}" == "$worktree_name" ]]; then
      printf '%s\n' "${PORT_OFFSET_CACHE_VALUES[$cache_index]}"
      return 0
    fi
  done

  return 1
}

store_cached_port_offset() {
  local worktree_name="$1"
  local resolved_offset="$2"
  PORT_OFFSET_CACHE_NAMES+=("$worktree_name")
  PORT_OFFSET_CACHE_VALUES+=("$resolved_offset")
}

calculate_port_offset() {
  local worktree_name="$1"
  local cached_offset
  local hash
  local hash_output

  if cached_offset="$(lookup_cached_port_offset "$worktree_name")"; then
    echo "$cached_offset"
    return
  fi

  if command -v md5sum >/dev/null 2>&1; then
    hash_output="$(printf '%s' "$worktree_name" | md5sum)"
    hash="${hash_output%% *}"
  elif command -v md5 >/dev/null 2>&1; then
    hash_output="$(printf '%s' "$worktree_name" | md5)"
    hash="${hash_output##*= }"
  else
    hash_output="$(printf '%s' "$worktree_name" | shasum)"
    hash="${hash_output%% *}"
  fi

  hash="${hash:0:4}"
  local hash_decimal=$((16#$hash))
  local range=$((PORT_OFFSET_MAX - PORT_OFFSET_MIN + 1))
  local resolved_offset=$(((hash_decimal % range) + PORT_OFFSET_MIN))
  store_cached_port_offset "$worktree_name" "$resolved_offset"
  echo "$resolved_offset"
}

resolve_port_offset_with_active_worktrees() {
  local worktree_name="$1"
  shift || true

  local range=$((PORT_OFFSET_MAX - PORT_OFFSET_MIN + 1))
  local used_offsets='|'
  local seen_names='|'
  local target_offset=''
  local ordered_names=()

  for existing_worktree_name in "$@"; do
    if [[ -z "$existing_worktree_name" ]]; then
      continue
    fi

    if [[ "$seen_names" != *"|$existing_worktree_name|"* ]]; then
      ordered_names+=("$existing_worktree_name")
      seen_names="${seen_names}${existing_worktree_name}|"
    fi
  done

  if [[ "$seen_names" != *"|$worktree_name|"* ]]; then
    ordered_names+=("$worktree_name")
  fi

  for ordered_name in "${ordered_names[@]}"; do
    local candidate_offset
    candidate_offset="$(calculate_port_offset "$ordered_name")"

    for ((attempt = 0; attempt < range; attempt += 1)); do
      if [[ "$used_offsets" != *"|$candidate_offset|"* ]]; then
        break
      fi

      candidate_offset=$((candidate_offset + 1))
      if ((candidate_offset > PORT_OFFSET_MAX)); then
        candidate_offset=$PORT_OFFSET_MIN
      fi
    done

    used_offsets="${used_offsets}${candidate_offset}|"
    if [[ "$ordered_name" == "$worktree_name" ]]; then
      target_offset="$candidate_offset"
    fi
  done

  if [[ -z "$target_offset" ]]; then
    target_offset="$(calculate_port_offset "$worktree_name")"
  fi

  echo "$target_offset"
}

allocate_worktree_ports() {
  local worktree_name="$1"
  shift || true

  local offset
  if [[ $# -gt 0 ]]; then
    offset="$(resolve_port_offset_with_active_worktrees "$worktree_name" "$@")"
  else
    offset="$(calculate_port_offset "$worktree_name")"
  fi

  echo "WEB_PORT=$((DEFAULT_WEB_BASE_PORT + offset))"
  echo "API_PORT=$((DEFAULT_API_BASE_PORT + offset))"
  echo "MOBILE_PORT=$((DEFAULT_MOBILE_BASE_PORT + offset))"
  echo "WORKER_INSPECT_PORT=$((DEFAULT_WORKER_INSPECT_BASE_PORT + offset))"
  echo "GRAFANA_PORT=$((DEFAULT_GRAFANA_BASE_PORT + offset))"
  echo "PROMETHEUS_PORT=$((DEFAULT_PROMETHEUS_BASE_PORT + offset))"
  echo "WORKTREE_PORT_OFFSET=$offset"
}

get_port_summary() {
  local worktree_name="$1"
  shift || true

  local offset
  if [[ $# -gt 0 ]]; then
    offset="$(resolve_port_offset_with_active_worktrees "$worktree_name" "$@")"
  else
    offset="$(calculate_port_offset "$worktree_name")"
  fi

  echo "Web:        $((DEFAULT_WEB_BASE_PORT + offset))"
  echo "API:        $((DEFAULT_API_BASE_PORT + offset))"
  echo "Mobile:     $((DEFAULT_MOBILE_BASE_PORT + offset))"
  echo "Worker dbg: $((DEFAULT_WORKER_INSPECT_BASE_PORT + offset))"
  echo "Grafana:    $((DEFAULT_GRAFANA_BASE_PORT + offset))"
  echo "Prometheus: $((DEFAULT_PROMETHEUS_BASE_PORT + offset))"
}
