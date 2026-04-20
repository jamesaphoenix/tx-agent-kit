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

# Multi-worktree safety: resolve the db-filename against the PRIMARY git
# checkout, not the current worktree. Without this, every worktree runs
# `start-dev.sh` with its OWN `.data/temporal/dev-state.db`, but they all
# try to listen on port 7233 — so whichever starts first wins and later
# worktrees see a stale handle pointing at a different db file. A single
# shared server + db on the primary checkout (paired with per-worktree
# task queues via WORKTREE_TASK_QUEUE in .env) is the intended topology.
# Matches the pattern in scripts/worktree/setup.sh for .env seeding.
resolve_primary_worktree_path() {
  local list
  if ! list="$(git -C "$PROJECT_ROOT" worktree list --porcelain 2>/dev/null)"; then
    printf '%s\n' "$PROJECT_ROOT"
    return
  fi
  local primary
  primary="$(printf '%s\n' "$list" | awk '/^worktree /{print $2; exit}')"
  if [[ -z "$primary" ]]; then
    primary="$PROJECT_ROOT"
  fi
  printf '%s\n' "$primary"
}
TEMPORAL_PRIMARY_WORKTREE_PATH="$(resolve_primary_worktree_path)"
TEMPORAL_CLI_DB_FILENAME="${TEMPORAL_CLI_DB_FILENAME:-$TEMPORAL_PRIMARY_WORKTREE_PATH/.data/temporal/dev-state.db}"
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

run_temporal_cli_dev_command() {
  env \
    -u TEMPORAL_API_KEY \
    -u TEMPORAL_TLS \
    -u TEMPORAL_TLS_ENABLED \
    -u TEMPORAL_TLS_SERVER_NAME \
    temporal "$@"
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
  run_temporal_cli_dev_command operator cluster health \
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
