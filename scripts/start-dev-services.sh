#!/usr/bin/env bash
# Idempotent infrastructure startup for local development.
# Designed to be safe across multiple git worktrees by pinning the
# Docker Compose project name.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_PROJECT_NAME="tx-agent-kit"

cd "$PROJECT_ROOT"

check_tcp_port() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z localhost "$port" >/dev/null 2>&1
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$port" -P -n >/dev/null 2>&1
    return $?
  fi

  return 1
}

check_postgres() {
  local container_id
  container_id="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q postgres 2>/dev/null || true)"
  [[ -n "$container_id" ]] && docker exec "$container_id" pg_isready -U postgres -d tx_agent_kit >/dev/null 2>&1
}

check_temporal() { check_tcp_port 7233; }
check_otel() { curl -fsS "http://localhost:13133/health/status" >/dev/null 2>&1; }
check_prometheus() { curl -fsS "http://localhost:9090/-/healthy" >/dev/null 2>&1; }
check_grafana() { curl -fsS "http://localhost:3001/api/health" >/dev/null 2>&1; }
check_jaeger() { curl -fsS "http://localhost:16686" >/dev/null 2>&1; }
check_loki() { curl -fsS "http://localhost:3100/ready" >/dev/null 2>&1; }

all_healthy() {
  check_postgres &&
  check_temporal &&
  check_otel &&
  check_prometheus &&
  check_grafana &&
  check_jaeger &&
  check_loki
}

echo "Checking local infrastructure health..."
if all_healthy; then
  echo "Infrastructure already healthy (shared across worktrees)."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker first."
  exit 1
fi

echo "Starting infrastructure via Docker Compose project '$COMPOSE_PROJECT_NAME'..."
docker compose -p "$COMPOSE_PROJECT_NAME" --profile infra up -d

echo "Waiting for infrastructure readiness..."
for i in {1..120}; do
  if all_healthy; then
    echo "Infrastructure is ready."
    echo "Temporal UI:  http://localhost:8233"
    echo "Grafana:      http://localhost:3001"
    echo "Prometheus:   http://localhost:9090"
    echo "Jaeger:       http://localhost:16686"
    exit 0
  fi

  if (( i % 10 == 0 )); then
    echo "Still waiting... (${i}s)"
  fi

  sleep 1
done

echo "Timed out waiting for infrastructure readiness (120s)."
echo "Inspect logs with: docker compose -p $COMPOSE_PROJECT_NAME logs"
exit 1
