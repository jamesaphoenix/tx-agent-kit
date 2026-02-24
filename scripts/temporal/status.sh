#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

echo "Temporal runtime mode: ${TEMPORAL_RUNTIME_MODE}"
echo "Temporal address: $(temporal_cli_address)"

if ! is_cli_runtime_mode; then
  echo "Local Temporal CLI server management is disabled for this mode."
  exit 0
fi

temporal_pid=""
if temporal_pid="$(read_temporal_pid)" && is_pid_alive "$temporal_pid"; then
  echo "Temporal CLI pid: ${temporal_pid} (managed)"
else
  echo "Temporal CLI pid: not managed by pid file"
fi

if is_temporal_cli_healthy; then
  echo "Temporal CLI health: healthy"
  exit 0
fi

echo "Temporal CLI health: unavailable"
exit 1
