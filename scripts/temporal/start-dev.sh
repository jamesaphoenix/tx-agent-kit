#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

if ! is_cli_runtime_mode; then
  echo "Temporal runtime mode is '${TEMPORAL_RUNTIME_MODE}'. Skipping local Temporal CLI startup."
  exit 0
fi

ensure_temporal_cli_installed

stop_stale_temporal_process() {
  local pid="$1"

  echo "Stopping stale Temporal CLI process (pid=${pid})..."
  kill "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 15); do
    if ! is_pid_alive "$pid"; then
      return 0
    fi
    sleep 1
  done

  echo "Stale Temporal CLI process did not stop on SIGTERM; sending SIGKILL."
  kill -9 "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 5); do
    if ! is_pid_alive "$pid"; then
      return 0
    fi
    sleep 1
  done

  return 1
}

if is_temporal_cli_healthy; then
  echo "Temporal CLI server is already healthy at $(temporal_cli_address)."
  exit 0
fi

existing_pid=""
if existing_pid="$(read_temporal_pid)" && is_pid_alive "$existing_pid"; then
  echo "Temporal CLI process is running (pid=${existing_pid}) but not healthy yet. Waiting up to ${TEMPORAL_CLI_EXISTING_PROCESS_GRACE_SECONDS}s before restart..."
  if wait_for_temporal_cli_health "$TEMPORAL_CLI_EXISTING_PROCESS_GRACE_SECONDS"; then
    echo "Temporal CLI server is healthy at $(temporal_cli_address)."
    exit 0
  fi

  echo "Temporal CLI process (pid=${existing_pid}) did not become healthy in time; attempting managed restart."
  if ! stop_stale_temporal_process "$existing_pid"; then
    echo "Unable to stop stale Temporal CLI process (pid=${existing_pid})."
    exit 1
  fi

  clear_temporal_pid_file
fi

clear_temporal_pid_file

if check_tcp_port "$TEMPORAL_CLI_PORT"; then
  echo "Temporal host port ${TEMPORAL_CLI_PORT} is in use and no healthy Temporal CLI server was detected."
  echo "Set TEMPORAL_CLI_PORT to a free port or stop the conflicting process."
  exit 1
fi

if [[ -n "$TEMPORAL_CLI_DB_FILENAME" ]]; then
  mkdir -p "$(dirname "$TEMPORAL_CLI_DB_FILENAME")"
fi
mkdir -p "$(dirname "$TEMPORAL_LOG_FILE")"

echo "Starting Temporal CLI dev server on $(temporal_cli_address)..."
if [[ -n "$TEMPORAL_CLI_DB_FILENAME" ]]; then
  nohup temporal server start-dev \
    --ip "$TEMPORAL_CLI_ADDRESS" \
    --port "$TEMPORAL_CLI_PORT" \
    --ui-ip "$TEMPORAL_CLI_ADDRESS" \
    --ui-port "$TEMPORAL_CLI_UI_PORT" \
    --metrics-port "$TEMPORAL_CLI_METRICS_PORT" \
    --db-filename "$TEMPORAL_CLI_DB_FILENAME" \
    </dev/null >"$TEMPORAL_LOG_FILE" 2>&1 &
else
  nohup temporal server start-dev \
    --ip "$TEMPORAL_CLI_ADDRESS" \
    --port "$TEMPORAL_CLI_PORT" \
    --ui-ip "$TEMPORAL_CLI_ADDRESS" \
    --ui-port "$TEMPORAL_CLI_UI_PORT" \
    --metrics-port "$TEMPORAL_CLI_METRICS_PORT" \
    </dev/null >"$TEMPORAL_LOG_FILE" 2>&1 &
fi

temporal_pid="$!"
printf '%s\n' "$temporal_pid" >"$TEMPORAL_PID_FILE"

if wait_for_temporal_cli_health "$TEMPORAL_CLI_STARTUP_TIMEOUT_SECONDS"; then
  echo "Temporal CLI server started (pid=${temporal_pid})."
  echo "Temporal address: $(temporal_cli_address)"
  echo "Temporal UI: http://${TEMPORAL_CLI_ADDRESS}:${TEMPORAL_CLI_UI_PORT}"
  echo "Temporal log: $TEMPORAL_LOG_FILE"
  exit 0
fi

echo "Temporal CLI failed to become healthy within ${TEMPORAL_CLI_STARTUP_TIMEOUT_SECONDS}s."
echo "Recent log output:"
tail -n 80 "$TEMPORAL_LOG_FILE" || true

kill "$temporal_pid" >/dev/null 2>&1 || true
wait "$temporal_pid" >/dev/null 2>&1 || true
clear_temporal_pid_file

exit 1
