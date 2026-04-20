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
# LOKI_PORT is used by `check_loki` / `check-observability.sh` against
# the host port. `LOKI_HOST_PORT` (env) is what docker-compose reads for
# the `ports:` mapping. Keep them in sync: if the caller sets only one
# of them, the other follows. This lets `LOKI_HOST_PORT=3101 pnpm
# infra:ensure` pass without a second env var.
LOKI_PORT="${LOKI_PORT:-${LOKI_HOST_PORT:-3100}}"
export LOKI_HOST_PORT="${LOKI_HOST_PORT:-${LOKI_PORT}}"
REDIS_PORT="${REDIS_PORT:-6379}"
SPOTLIGHT_PORT="${SPOTLIGHT_PORT:-8969}"
LANGFUSE_PORT="${LANGFUSE_PORT:-3003}"
LANGFUSE_WORKER_PORT="${LANGFUSE_WORKER_PORT:-3030}"
INFRA_READY_TIMEOUT_SECONDS="${INFRA_READY_TIMEOUT_SECONDS:-240}"

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

# check_loki MUST content-validate the response. A plain `check_http_endpoint`
# accepts any HTTP 2xx/3xx, which is true even when another process (e.g.
# a Next.js dev server, which returns 308 on /ready) is shadowing
# the Loki host port via IPv6. macOS prefers IPv6 for `localhost`
# resolution, so when both Docker's IPv4 forward and a bare Next.js
# process sit on the same port, curl hits Next.js instead of Loki.
#
# Loki's /ready endpoint returns exactly `ready\n`. Asserting that
# body string catches the shadowing case before it pollutes test runs.
check_loki() {
  local body
  body="$(curl -fsS -L --connect-timeout 1 --max-time 2 "http://localhost:${LOKI_PORT}/ready" 2>/dev/null || true)"
  [[ "$body" == *"ready"* && "$body" != *"<html"* ]]
}
check_redis() {
  local container_id
  container_id="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q redis 2>/dev/null || true)"
  [[ -n "$container_id" ]] && docker exec "$container_id" redis-cli ping >/dev/null 2>&1
}
check_spotlight() { check_http_endpoint "http://localhost:${SPOTLIGHT_PORT}"; }
check_langfuse_web() { check_http_endpoint "http://localhost:${LANGFUSE_PORT}/api/public/health"; }
check_langfuse_worker() { check_http_endpoint "http://localhost:${LANGFUSE_WORKER_PORT}/api/health"; }

ensure_langfuse_bootstrap() {
  "$PROJECT_ROOT/scripts/langfuse/ensure-local-bootstrap.sh"
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
  check_redis &&
  check_spotlight &&
  check_langfuse_web &&
  check_langfuse_worker
}

compose_up_with_recovery() {
  local compose_services=()
  if [[ "${COMPOSE_SKIP_SPOTLIGHT:-false}" == "true" ]]; then
    # `docker compose up <services...>` starts only the named services.
    # We enumerate everything in the `infra` profile EXCEPT spotlight so
    # an external Spotlight listener on 8969 doesn't block the rest of
    # the stack from coming up.
    compose_services=(
      postgres redis otel-collector jaeger prometheus grafana loki
      promtail node-exporter langfuse-postgres langfuse-clickhouse
      langfuse-minio langfuse-redis langfuse-worker langfuse-web
    )
  fi

  if ((${#compose_services[@]} > 0)); then
    if docker compose -p "$COMPOSE_PROJECT_NAME" --profile infra up -d "${compose_services[@]}"; then
      return 0
    fi
    echo "Docker Compose startup failed; resetting project resources and retrying once."
    docker compose -p "$COMPOSE_PROJECT_NAME" down --remove-orphans >/dev/null 2>&1 || true
    if docker compose -p "$COMPOSE_PROJECT_NAME" --profile infra up -d "${compose_services[@]}"; then
      return 0
    fi
    return 1
  fi

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
  ensure_langfuse_bootstrap
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
assert_port_not_conflicted "langfuse-web" "3000" "$LANGFUSE_PORT" "Langfuse web"
assert_port_not_conflicted "langfuse-worker" "3030" "$LANGFUSE_WORKER_PORT" "Langfuse worker"

# Spotlight is allowed to already be running externally (the native Spotlight
# desktop app, or an `npx spotlight mcp` sidecar). If something on 8969 is
# already answering the Spotlight HTTP check, trust it and tell Docker
# Compose to skip the `spotlight` service for this run instead of aborting.
COMPOSE_SKIP_SPOTLIGHT="false"
if check_spotlight; then
  echo "External Spotlight already responding on port ${SPOTLIGHT_PORT}; skipping the spotlight container."
  COMPOSE_SKIP_SPOTLIGHT="true"
else
  assert_port_not_conflicted "spotlight" "8969" "$SPOTLIGHT_PORT" "Spotlight"
fi

echo "Starting infrastructure via Docker Compose project '$COMPOSE_PROJECT_NAME'..."
if ! compose_up_with_recovery; then
  echo "Failed to start infrastructure via Docker Compose."
  exit 1
fi

echo "Waiting for infrastructure readiness..."
for ((i = 1; i <= INFRA_READY_TIMEOUT_SECONDS; i++)); do
  if all_healthy; then
    ensure_langfuse_bootstrap
    echo "Infrastructure is ready."
    echo "Grafana:      http://localhost:${GRAFANA_PORT}"
    echo "Prometheus:   http://localhost:${PROMETHEUS_PORT}"
    echo "Jaeger:       http://localhost:${JAEGER_UI_PORT}"
    echo "Redis:        localhost:${REDIS_PORT}"
    echo "Spotlight:    http://localhost:${SPOTLIGHT_PORT}"
    echo "Langfuse:     http://localhost:${LANGFUSE_PORT}"
    exit 0
  fi

  if (( i % 10 == 0 )); then
    echo "Still waiting... (${i}s)"
  fi

  sleep 1
done

echo "Timed out waiting for infrastructure readiness (${INFRA_READY_TIMEOUT_SECONDS}s)."

# Walk each check once more and print which specific one is still red so
# developers don't have to hunt through docker logs for the culprit.
echo "Per-service health:"
check_postgres && echo "  postgres: OK" || echo "  postgres: FAIL"
check_otel && echo "  otel-collector: OK" || echo "  otel-collector: FAIL"
check_prometheus && echo "  prometheus: OK" || echo "  prometheus: FAIL"
check_grafana && echo "  grafana: OK" || echo "  grafana: FAIL"
check_jaeger && echo "  jaeger: OK" || echo "  jaeger: FAIL"
check_redis && echo "  redis: OK" || echo "  redis: FAIL"
check_spotlight && echo "  spotlight: OK" || echo "  spotlight: FAIL"
check_langfuse_web && echo "  langfuse-web: OK" || echo "  langfuse-web: FAIL"
check_langfuse_worker && echo "  langfuse-worker: OK" || echo "  langfuse-worker: FAIL"

if check_loki; then
  echo "  loki: OK"
else
  echo "  loki: FAIL"
  # Grab the body Loki (or the hijacker) actually returned so the
  # developer can diagnose at a glance.
  loki_body="$(curl -sS -L --connect-timeout 1 --max-time 2 "http://localhost:${LOKI_PORT}/ready" 2>&1 || true)"
  echo "    /ready response preview: $(printf '%s' "$loki_body" | head -c 160)"
  if [[ "$loki_body" == *"<html"* || "$loki_body" == *"<!DOCTYPE"* ]]; then
    echo
    echo "Loki host port ${LOKI_PORT} appears to be hijacked by another process."
    echo "Another listener (probably a Next.js dev server from a different project) is answering"
    echo "on this port via IPv6, so Loki's IPv4 forward is shadowed."
    echo
    echo "Diagnose:   lsof -P -iTCP:${LOKI_PORT} -sTCP:LISTEN"
    echo "Fix:        LOKI_HOST_PORT=3101 pnpm infra:ensure"
    echo "            LOKI_PORT=3101 pnpm test:integration"
  fi
fi

echo
echo "Inspect logs with: docker compose -p $COMPOSE_PROJECT_NAME logs"
exit 1
