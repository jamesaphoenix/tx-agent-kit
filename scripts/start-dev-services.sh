#!/usr/bin/env bash
# Idempotent infrastructure startup for local development.
# Designed to be safe across multiple git worktrees by pinning the
# Docker Compose project name.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"
OTEL_HEALTH_PORT="${OTEL_HEALTH_PORT:-13133}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"
JAEGER_UI_PORT="${JAEGER_UI_PORT:-16686}"
LOKI_PORT="${LOKI_PORT:-3100}"
REDIS_PORT="${REDIS_PORT:-6379}"
INFRA_READY_TIMEOUT_SECONDS="${INFRA_READY_TIMEOUT_SECONDS:-120}"

cd "$PROJECT_ROOT"

if ! [[ "$INFRA_READY_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( INFRA_READY_TIMEOUT_SECONDS < 1 )); then
  echo "INFRA_READY_TIMEOUT_SECONDS must be a positive integer (received: ${INFRA_READY_TIMEOUT_SECONDS})."
  exit 1
fi

check_tcp_port() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$port" -P -n >/dev/null 2>&1
    return $?
  fi

  # Fallback for environments that do not ship nc/lsof (for example lean containers).
  if [[ -n "${BASH_VERSION:-}" ]]; then
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
    return $?
  fi

  return 1
}

check_postgres() {
  local container_id
  container_id="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q postgres 2>/dev/null || true)"
  [[ -n "$container_id" ]] && docker exec "$container_id" pg_isready -U postgres -d tx_agent_kit >/dev/null 2>&1
}

check_http_endpoint() {
  local url="$1"
  curl -fsS --connect-timeout 1 --max-time 2 "$url" >/dev/null 2>&1
}

check_otel() { check_http_endpoint "http://localhost:${OTEL_HEALTH_PORT}/health/status"; }
check_prometheus() { check_http_endpoint "http://localhost:${PROMETHEUS_PORT}/-/healthy"; }
check_grafana() { check_http_endpoint "http://localhost:${GRAFANA_PORT}/api/health"; }
check_jaeger() { check_http_endpoint "http://localhost:${JAEGER_UI_PORT}"; }
check_loki() { check_http_endpoint "http://localhost:${LOKI_PORT}/ready"; }
check_redis() {
  local container_id
  container_id="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q redis 2>/dev/null || true)"
  [[ -n "$container_id" ]] && docker exec "$container_id" redis-cli ping >/dev/null 2>&1
}

service_running() {
  local service="$1"
  local container_id
  container_id="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q "$service" 2>/dev/null || true)"
  [[ -n "$container_id" ]]
}

compose_mapped_host_port() {
  local service="$1"
  local container_port="$2"
  local mapped_output=""
  mapped_output="$(docker compose -p "$COMPOSE_PROJECT_NAME" port "$service" "$container_port" 2>/dev/null || true)"
  if [[ -z "$mapped_output" ]]; then
    return 1
  fi

  local mapped_host_port="${mapped_output##*:}"
  if [[ -z "$mapped_host_port" ]]; then
    return 1
  fi

  printf '%s\n' "$mapped_host_port"
}

assert_port_not_conflicted() {
  local service="$1"
  local container_port="$2"
  local host_port="$3"
  local label="$4"

  local mapped_output=''
  local mapped_host_port=''
  mapped_output="$(docker compose -p "$COMPOSE_PROJECT_NAME" port "$service" "$container_port" 2>/dev/null || true)"
  if [[ -n "$mapped_output" ]]; then
    mapped_host_port="${mapped_output##*:}"
  fi

  if check_tcp_port "$host_port" && [[ "$mapped_host_port" != "$host_port" ]]; then
    echo "${label} host port ${host_port} is in use by another process."
    echo "Stop the conflicting process (or override the port env var if supported) before running infra startup."
    exit 1
  fi
}

all_healthy() {
  check_postgres &&
  check_otel &&
  check_prometheus &&
  check_grafana &&
  check_jaeger &&
  check_loki &&
  check_redis
}

compose_up_with_recovery() {
  if docker compose -p "$COMPOSE_PROJECT_NAME" --profile infra up -d; then
    return 0
  fi

  echo "Docker Compose startup failed; resetting project resources and retrying once."
  docker compose -p "$COMPOSE_PROJECT_NAME" down --remove-orphans >/dev/null 2>&1 || true

  if docker compose -p "$COMPOSE_PROJECT_NAME" --profile infra up -d; then
    return 0
  fi

  return 1
}

resolve_available_port() {
  local candidate="${1:-}"
  if [[ -z "$candidate" ]]; then
    echo "resolve_available_port requires a starting port candidate" >&2
    return 1
  fi

  while true; do
    if ! check_tcp_port "$candidate"; then
      echo "$candidate"
      return
    fi

    candidate=$((candidate + 1))
  done
}

# If Grafana's default host port is occupied by a non-Grafana process,
# select a free fallback to keep infra startup resilient on shared dev machines.
mapped_grafana_host_port="$(compose_mapped_host_port "grafana" "3000" || true)"
if check_tcp_port "$GRAFANA_PORT" && [[ "$mapped_grafana_host_port" != "$GRAFANA_PORT" ]] && ! check_grafana; then
  fallback_start_port=$((GRAFANA_PORT + 1))
  fallback_port="$(resolve_available_port "$fallback_start_port")"
  echo "Grafana host port ${GRAFANA_PORT} is in use by another process; using ${fallback_port}."
  GRAFANA_PORT="$fallback_port"
  export GRAFANA_PORT
fi

echo "Checking local infrastructure health..."
if all_healthy; then
  echo "Infrastructure already healthy (shared across worktrees)."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker first."
  exit 1
fi

assert_port_not_conflicted "otel-collector" "13133" "$OTEL_HEALTH_PORT" "OpenTelemetry Collector health"
assert_port_not_conflicted "prometheus" "9090" "$PROMETHEUS_PORT" "Prometheus"
assert_port_not_conflicted "jaeger" "16686" "$JAEGER_UI_PORT" "Jaeger"
assert_port_not_conflicted "loki" "3100" "$LOKI_PORT" "Loki"
assert_port_not_conflicted "redis" "6379" "$REDIS_PORT" "Redis"

echo "Starting infrastructure via Docker Compose project '$COMPOSE_PROJECT_NAME'..."
if ! compose_up_with_recovery; then
  echo "Failed to start infrastructure via Docker Compose."
  exit 1
fi

echo "Waiting for infrastructure readiness..."
for ((i = 1; i <= INFRA_READY_TIMEOUT_SECONDS; i++)); do
  if all_healthy; then
    echo "Infrastructure is ready."
    echo "Grafana:      http://localhost:${GRAFANA_PORT}"
    echo "Prometheus:   http://localhost:${PROMETHEUS_PORT}"
    echo "Jaeger:       http://localhost:${JAEGER_UI_PORT}"
    echo "Redis:        localhost:${REDIS_PORT}"
    exit 0
  fi

  if (( i % 10 == 0 )); then
    echo "Still waiting... (${i}s)"
  fi

  sleep 1
done

echo "Timed out waiting for infrastructure readiness (${INFRA_READY_TIMEOUT_SECONDS}s)."
echo "Inspect logs with: docker compose -p $COMPOSE_PROJECT_NAME logs"
exit 1
