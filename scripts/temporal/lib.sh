#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"
TEMPORAL_RUNTIME_MODE="${TEMPORAL_RUNTIME_MODE:-cli}"
TEMPORAL_CLI_ADDRESS="${TEMPORAL_CLI_ADDRESS:-127.0.0.1}"
TEMPORAL_CLI_PORT="${TEMPORAL_CLI_PORT:-7233}"
TEMPORAL_CLI_UI_PORT="${TEMPORAL_CLI_UI_PORT:-8233}"
TEMPORAL_CLI_METRICS_PORT="${TEMPORAL_CLI_METRICS_PORT:-9091}"
TEMPORAL_CLI_DB_FILENAME="${TEMPORAL_CLI_DB_FILENAME:-$PROJECT_ROOT/.data/temporal/dev-state.db}"
TEMPORAL_CLI_STARTUP_TIMEOUT_SECONDS="${TEMPORAL_CLI_STARTUP_TIMEOUT_SECONDS:-30}"
TEMPORAL_CLI_EXISTING_PROCESS_GRACE_SECONDS="${TEMPORAL_CLI_EXISTING_PROCESS_GRACE_SECONDS:-5}"
TEMPORAL_CLI_HEALTH_COMMAND_TIMEOUT="${TEMPORAL_CLI_HEALTH_COMMAND_TIMEOUT:-3s}"
TEMPORAL_PID_FILE="/tmp/${COMPOSE_PROJECT_NAME}-temporal-cli.pid"
TEMPORAL_LOG_FILE="${TEMPORAL_CLI_LOG_FILE:-/tmp/${COMPOSE_PROJECT_NAME}-temporal-cli.log}"

temporal_cli_address() {
  printf '%s:%s\n' "$TEMPORAL_CLI_ADDRESS" "$TEMPORAL_CLI_PORT"
}

ensure_temporal_cli_installed() {
  if ! command -v temporal >/dev/null 2>&1; then
    echo "Temporal CLI is required but was not found on PATH."
    echo "Install from https://docs.temporal.io/cli or run with TEMPORAL_RUNTIME_MODE=cloud."
    exit 1
  fi
}

is_cli_runtime_mode() {
  [[ "$TEMPORAL_RUNTIME_MODE" == "cli" ]]
}

is_pid_alive() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

read_temporal_pid() {
  if [[ ! -f "$TEMPORAL_PID_FILE" ]]; then
    return 1
  fi

  local parsed_pid
  parsed_pid="$(tr -d '[:space:]' <"$TEMPORAL_PID_FILE")"
  if [[ -z "$parsed_pid" || ! "$parsed_pid" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf '%s\n' "$parsed_pid"
}

clear_temporal_pid_file() {
  rm -f "$TEMPORAL_PID_FILE"
}

is_temporal_cli_healthy() {
  temporal operator cluster health \
    --address "$(temporal_cli_address)" \
    --command-timeout "$TEMPORAL_CLI_HEALTH_COMMAND_TIMEOUT" \
    --output none >/dev/null 2>&1
}

check_tcp_port() {
  local port="$1"

  if command -v nc >/dev/null 2>&1; then
    nc -z "$TEMPORAL_CLI_ADDRESS" "$port" >/dev/null 2>&1
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$port" -P -n >/dev/null 2>&1
    return $?
  fi

  if [[ -n "${BASH_VERSION:-}" ]]; then
    (exec 3<>"/dev/tcp/${TEMPORAL_CLI_ADDRESS}/${port}") >/dev/null 2>&1
    return $?
  fi

  return 1
}

wait_for_temporal_cli_health() {
  local timeout_seconds="$1"

  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_seconds" ]]; do
    if is_temporal_cli_healthy; then
      return 0
    fi

    # Fallback readiness check: Temporal CLI cluster health can lag even when
    # the dev server is already accepting gRPC traffic on the frontend port.
    if check_tcp_port "$TEMPORAL_CLI_PORT"; then
      return 0
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}
