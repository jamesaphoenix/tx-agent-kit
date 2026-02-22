#!/usr/bin/env bash
set -euo pipefail

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_LIB_DIR/colors.sh"

DEFAULT_WEB_BASE_PORT=3000
DEFAULT_API_BASE_PORT=4000
DEFAULT_GRAFANA_BASE_PORT=3001
DEFAULT_PROMETHEUS_BASE_PORT=9090
PORT_OFFSET_MIN=100
PORT_OFFSET_MAX=1099

calculate_port_offset() {
  local worktree_name="$1"
  local hash

  if command -v md5sum >/dev/null 2>&1; then
    hash=$(echo -n "$worktree_name" | md5sum | cut -c1-4)
  elif command -v md5 >/dev/null 2>&1; then
    hash=$(echo -n "$worktree_name" | md5 | cut -c1-4)
  else
    hash=$(echo -n "$worktree_name" | shasum | cut -c1-4)
  fi

  local hash_decimal=$((16#$hash))
  local range=$((PORT_OFFSET_MAX - PORT_OFFSET_MIN + 1))
  echo $(((hash_decimal % range) + PORT_OFFSET_MIN))
}

allocate_worktree_ports() {
  local worktree_name="$1"
  local offset
  offset=$(calculate_port_offset "$worktree_name")

  echo "WEB_PORT=$((DEFAULT_WEB_BASE_PORT + offset))"
  echo "API_PORT=$((DEFAULT_API_BASE_PORT + offset))"
  echo "GRAFANA_PORT=$((DEFAULT_GRAFANA_BASE_PORT + offset))"
  echo "PROMETHEUS_PORT=$((DEFAULT_PROMETHEUS_BASE_PORT + offset))"
  echo "WORKTREE_PORT_OFFSET=$offset"
}

get_port_summary() {
  local worktree_name="$1"
  local offset
  offset=$(calculate_port_offset "$worktree_name")

  echo "Web:        $((DEFAULT_WEB_BASE_PORT + offset))"
  echo "API:        $((DEFAULT_API_BASE_PORT + offset))"
  echo "Grafana:    $((DEFAULT_GRAFANA_BASE_PORT + offset))"
  echo "Prometheus: $((DEFAULT_PROMETHEUS_BASE_PORT + offset))"
}
