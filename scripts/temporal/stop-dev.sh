#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

temporal_pid=""
if ! temporal_pid="$(read_temporal_pid)"; then
  clear_temporal_pid_file
  if is_temporal_cli_healthy; then
    echo "Temporal CLI server is healthy at $(temporal_cli_address), but not managed by this repo pid file."
    echo "Stop it manually if needed."
    exit 0
  fi

  echo "Temporal CLI server is not running."
  exit 0
fi

if ! is_pid_alive "$temporal_pid"; then
  clear_temporal_pid_file
  echo "Temporal CLI pid file was stale and has been removed."
  exit 0
fi

echo "Stopping Temporal CLI server (pid=${temporal_pid})..."
kill "$temporal_pid" >/dev/null 2>&1 || true

for _ in $(seq 1 30); do
  if ! is_pid_alive "$temporal_pid"; then
    clear_temporal_pid_file
    echo "Temporal CLI server stopped."
    exit 0
  fi
  sleep 1
done

echo "Graceful shutdown timed out; sending SIGKILL to pid=${temporal_pid}."
kill -9 "$temporal_pid" >/dev/null 2>&1 || true
clear_temporal_pid_file
echo "Temporal CLI server stopped."
