#!/usr/bin/env bash
# Idempotent infrastructure startup for local development.
# Designed to be safe across multiple git worktrees by pinning the
# Docker Compose project name.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

POSTGRES_PORT_PROVIDED="${POSTGRES_PORT+x}"
OTEL_GRPC_PORT_PROVIDED="${OTEL_GRPC_PORT+x}"
OTEL_HTTP_PORT_PROVIDED="${OTEL_HTTP_PORT+x}"
OTEL_METRICS_PORT_PROVIDED="${OTEL_METRICS_PORT+x}"
OTEL_HEALTH_PORT_PROVIDED="${OTEL_HEALTH_PORT+x}"
PROMETHEUS_PORT_PROVIDED="${PROMETHEUS_PORT+x}"
NODE_EXPORTER_PORT_PROVIDED="${NODE_EXPORTER_PORT+x}"
GRAFANA_PORT_PROVIDED="${GRAFANA_PORT+x}"
JAEGER_UI_PORT_PROVIDED="${JAEGER_UI_PORT+x}"
JAEGER_OTLP_GRPC_PORT_PROVIDED="${JAEGER_OTLP_GRPC_PORT+x}"
JAEGER_OTLP_HTTP_PORT_PROVIDED="${JAEGER_OTLP_HTTP_PORT+x}"
LOKI_PORT_PROVIDED="${LOKI_PORT+x}${LOKI_HOST_PORT+x}"
REDIS_PORT_PROVIDED="${REDIS_PORT+x}"
LANGFUSE_PORT_PROVIDED="${LANGFUSE_PORT+x}"
LANGFUSE_WORKER_PORT_PROVIDED="${LANGFUSE_WORKER_PORT+x}"
LANGFUSE_CLICKHOUSE_HTTP_PORT_PROVIDED="${LANGFUSE_CLICKHOUSE_HTTP_PORT+x}"
LANGFUSE_CLICKHOUSE_TCP_PORT_PROVIDED="${LANGFUSE_CLICKHOUSE_TCP_PORT+x}"
LANGFUSE_MINIO_PORT_PROVIDED="${LANGFUSE_MINIO_PORT+x}"
LANGFUSE_MINIO_CONSOLE_PORT_PROVIDED="${LANGFUSE_MINIO_CONSOLE_PORT+x}"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/source-env.sh"
source_env "$PROJECT_ROOT/.env"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"
OTEL_GRPC_PORT="${OTEL_GRPC_PORT:-4319}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
OTEL_HTTP_PORT="${OTEL_HTTP_PORT:-4320}"
OTEL_METRICS_PORT="${OTEL_METRICS_PORT:-8888}"
OTEL_HEALTH_PORT="${OTEL_HEALTH_PORT:-13133}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
NODE_EXPORTER_PORT="${NODE_EXPORTER_PORT:-9100}"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"
JAEGER_UI_PORT="${JAEGER_UI_PORT:-16686}"
JAEGER_OTLP_GRPC_PORT="${JAEGER_OTLP_GRPC_PORT:-4317}"
JAEGER_OTLP_HTTP_PORT="${JAEGER_OTLP_HTTP_PORT:-4318}"
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
LANGFUSE_CLICKHOUSE_HTTP_PORT="${LANGFUSE_CLICKHOUSE_HTTP_PORT:-8123}"
LANGFUSE_CLICKHOUSE_TCP_PORT="${LANGFUSE_CLICKHOUSE_TCP_PORT:-9000}"
LANGFUSE_MINIO_PORT="${LANGFUSE_MINIO_PORT:-9092}"
LANGFUSE_MINIO_CONSOLE_PORT="${LANGFUSE_MINIO_CONSOLE_PORT:-9093}"
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

docker_daemon_ready() {
  docker ps --format '{{.ID}}' >/dev/null 2>&1
}

check_postgres() {
  local container_id
  container_id="$(compose_service_container_id postgres || true)"
  [[ -n "$container_id" ]] && docker exec "$container_id" pg_isready -U postgres -d tx_agent_kit >/dev/null 2>&1
}

check_http_endpoint() {
  local url="$1"
  curl -fsS --connect-timeout 1 --max-time 2 "$url" >/dev/null 2>&1
}

check_otel() { check_http_endpoint "http://127.0.0.1:${OTEL_HEALTH_PORT}/health/status"; }
check_prometheus() { check_http_endpoint "http://127.0.0.1:${PROMETHEUS_PORT}/-/healthy"; }
check_grafana() { check_http_endpoint "http://127.0.0.1:${GRAFANA_PORT}/api/health"; }
check_jaeger() { check_http_endpoint "http://127.0.0.1:${JAEGER_UI_PORT}"; }

# check_loki MUST content-validate the response. A plain `check_http_endpoint`
# accepts any HTTP 2xx/3xx, which is true even when another process (e.g.
# a Next.js dev server, which returns 308 on /ready) is shadowing
# the Loki host port.
#
# Loki's /ready endpoint returns exactly `ready\n`. Asserting that
# body string catches the shadowing case before it pollutes test runs.
check_loki() {
  local body
  body="$(curl -fsS -L --connect-timeout 1 --max-time 2 "http://127.0.0.1:${LOKI_PORT}/ready" 2>/dev/null || true)"
  [[ "$body" == *"ready"* && "$body" != *"<html"* ]]
}
check_redis() {
  local container_id
  container_id="$(compose_service_container_id redis || true)"
  if [[ -n "$container_id" ]] && docker exec "$container_id" redis-cli ping >/dev/null 2>&1; then
    return 0
  fi

  check_host_redis
}
check_spotlight() { check_http_endpoint "http://127.0.0.1:${SPOTLIGHT_PORT}"; }
check_langfuse_web() { service_running "langfuse-web" && check_http_endpoint "http://127.0.0.1:${LANGFUSE_PORT}/api/public/health"; }
check_langfuse_worker() { service_running "langfuse-worker" && check_http_endpoint "http://127.0.0.1:${LANGFUSE_WORKER_PORT}/api/health"; }

repo_observability_stack_healthy() {
  service_running "otel-collector" &&
  service_running "prometheus" &&
  service_running "jaeger" &&
  service_running "loki" &&
  service_running "grafana" &&
  check_otel &&
  check_prometheus &&
  check_jaeger &&
  check_loki &&
  check_grafana
}

external_observability_stack_healthy() {
  [[ "${TX_ALLOW_EXTERNAL_OBSERVABILITY_STACK:-0}" == "1" ]] &&
  check_otel &&
  check_prometheus &&
  check_jaeger &&
  check_loki &&
  check_grafana
}

check_host_redis() {
  if command -v redis-cli >/dev/null 2>&1; then
    [[ "$(redis-cli -h 127.0.0.1 -p "$REDIS_PORT" ping 2>/dev/null || true)" == "PONG" ]]
    return $?
  fi

  if [[ -n "${BASH_VERSION:-}" ]]; then
    local response=''
    { exec 9<>"/dev/tcp/127.0.0.1/${REDIS_PORT}"; } 2>/dev/null || return 1
    printf '*1\r\n$4\r\nPING\r\n' >&9
    IFS= read -r -t 1 response <&9 || true
    exec 9>&-
    [[ "$response" == "+PONG"* ]]
    return $?
  fi

  return 1
}

ensure_langfuse_bootstrap() {
  "$PROJECT_ROOT/scripts/langfuse/ensure-local-bootstrap.sh"
}

service_running() {
  local service="$1"
  local container_id
  container_id="$(compose_service_container_id "$service" || true)"
  [[ -n "$container_id" && "$(service_state "$service")" == "running" ]]
}

service_state() {
  local service="$1"
  local container_id
  container_id="$(compose_service_container_id "$service" all || true)"
  if [[ -z "$container_id" ]]; then
    return 1
  fi

  docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || true
}

service_health_status() {
  local service="$1"
  local container_id
  container_id="$(compose_service_container_id "$service" all || true)"
  if [[ -z "$container_id" ]]; then
    return 1
  fi

  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true
}

langfuse_dependencies_ready() {
  [[ "$(service_health_status "langfuse-postgres")" == "healthy" ]] &&
  [[ "$(service_health_status "langfuse-clickhouse")" == "healthy" ]] &&
  [[ "$(service_health_status "langfuse-minio")" == "healthy" ]] &&
  [[ "$(service_health_status "langfuse-redis")" == "healthy" ]]
}

LANGFUSE_WEB_RESTART_ATTEMPTED="false"

maybe_restart_langfuse_web_once() {
  if [[ "$LANGFUSE_WEB_RESTART_ATTEMPTED" == "true" ]]; then
    return 0
  fi

  if [[ "$(service_state "langfuse-web")" != "exited" ]]; then
    return 0
  fi

  if ! langfuse_dependencies_ready; then
    return 0
  fi

  echo "Langfuse web exited after startup; restarting it once now that dependencies are healthy."
  docker compose -p "$COMPOSE_PROJECT_NAME" up -d --no-deps langfuse-web >/dev/null
  LANGFUSE_WEB_RESTART_ATTEMPTED="true"
}

compose_mapped_host_port() {
  local service="$1"
  local container_port="$2"
  local container_id=""
  local mapped_output=""
  container_id="$(compose_service_container_id "$service" || true)"
  if [[ -z "$container_id" ]]; then
    return 1
  fi

  mapped_output="$(docker port "$container_id" "$container_port" 2>/dev/null | head -n 1 || true)"
  if [[ -z "$mapped_output" ]]; then
    return 1
  fi

  local mapped_host_port="${mapped_output##*:}"
  if [[ -z "$mapped_host_port" ]]; then
    return 1
  fi

  printf '%s\n' "$mapped_host_port"
}

compose_service_container_id() {
  local service="$1"
  local scope="${2:-running}"

  if [[ "$scope" == "all" ]]; then
    docker ps -a --format '{{.ID}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}' |
      awk -F '\t' -v project="$COMPOSE_PROJECT_NAME" -v service="$service" '$2 == project && $3 == service { print $1; exit }'
    return
  fi

  docker ps --format '{{.ID}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}' |
    awk -F '\t' -v project="$COMPOSE_PROJECT_NAME" -v service="$service" '$2 == project && $3 == service { print $1; exit }'
}

assert_port_not_conflicted() {
  local service="$1"
  local container_port="$2"
  local host_port="$3"
  local label="$4"

  local mapped_output=''
  local mapped_host_port=''
  mapped_output="$(compose_mapped_host_port "$service" "$container_port" || true)"
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
  check_redis &&
  check_spotlight &&
  check_langfuse_web &&
  check_langfuse_worker &&
  {
    [[ "${COMPOSE_SKIP_OBSERVABILITY:-false}" == "true" ]] ||
      {
        check_otel &&
          check_prometheus &&
          check_grafana &&
          check_jaeger &&
          check_loki
      }
  }
}

compose_up_with_recovery() {
  local all_compose_services=(
    postgres redis otel-collector jaeger prometheus grafana loki
    promtail node-exporter spotlight langfuse-postgres langfuse-clickhouse
    langfuse-minio langfuse-redis langfuse-worker langfuse-web
  )
  local compose_services=()

  if [[ "${COMPOSE_SKIP_OBSERVABILITY:-false}" == "true" || "${COMPOSE_SKIP_SPOTLIGHT:-false}" == "true" || "${COMPOSE_SKIP_OTEL_COLLECTOR:-false}" == "true" || "${COMPOSE_SKIP_REDIS:-false}" == "true" ]]; then
    # `docker compose up <services...>` starts only the named services.
    # Enumerate the infra profile and omit services that are already
    # provided externally on this host.
    for service in "${all_compose_services[@]}"; do
      if [[ "${COMPOSE_SKIP_OBSERVABILITY:-false}" == "true" ]]; then
        case "$service" in
          otel-collector|jaeger|prometheus|grafana|loki|promtail|node-exporter)
            continue
            ;;
        esac
      fi
      if [[ "$service" == "spotlight" && "${COMPOSE_SKIP_SPOTLIGHT:-false}" == "true" ]]; then
        continue
      fi
      if [[ "$service" == "otel-collector" && "${COMPOSE_SKIP_OTEL_COLLECTOR:-false}" == "true" ]]; then
        continue
      fi
      if [[ "$service" == "redis" && "${COMPOSE_SKIP_REDIS:-false}" == "true" ]]; then
        continue
      fi
      compose_services+=("$service")
    done
  fi

  if ((${#compose_services[@]} > 0)); then
    if docker compose -p "$COMPOSE_PROJECT_NAME" --profile infra up -d "${compose_services[@]}"; then
      return 0
    fi
    echo "Docker Compose startup failed; resetting project resources and retrying once."
    docker compose -p "$COMPOSE_PROJECT_NAME" down --remove-orphans >/dev/null 2>&1 || true
    sleep 2
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
  sleep 2

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
    if ! check_tcp_port "$candidate" && ! is_reserved_fallback_port "$candidate"; then
      echo "$candidate"
      return
    fi

    candidate=$((candidate + 1))
  done
}

RESERVED_FALLBACK_PORTS=" "

is_reserved_fallback_port() {
  local candidate="$1"
  [[ "$RESERVED_FALLBACK_PORTS" == *" ${candidate} "* ]]
}

reserve_fallback_port() {
  RESERVED_FALLBACK_PORTS="${RESERVED_FALLBACK_PORTS}${1} "
}

maybe_fallback_plain_host_port() {
  local env_var="$1"
  local label="$2"
  local service="$3"
  local container_port="$4"
  local current_port="${!env_var}"

  local mapped_host_port
  mapped_host_port="$(compose_mapped_host_port "$service" "$container_port" || true)"
  if check_tcp_port "$current_port" && [[ "$mapped_host_port" != "$current_port" ]]; then
    local fallback_start_port=$((current_port + 10000))
    local fallback_port
    fallback_port="$(resolve_available_port "$fallback_start_port")"
    echo "${label} host port ${current_port} is in use by another process; using ${fallback_port}."
    printf -v "$env_var" '%s' "$fallback_port"
    export "$env_var"
    reserve_fallback_port "$fallback_port"
  fi
}

maybe_fallback_http_service_host_port() {
  local env_var="$1"
  local label="$2"
  local healthy_name="$3"
  local service="$4"
  local container_port="$5"
  local health_check="$6"
  local current_port="${!env_var}"

  local mapped_host_port
  mapped_host_port="$(compose_mapped_host_port "$service" "$container_port" || true)"
  if check_tcp_port "$current_port" && { [[ "$mapped_host_port" != "$current_port" ]] || ! "$health_check"; }; then
    local fallback_start_port=$((current_port + 1))
    local fallback_port
    fallback_port="$(resolve_available_port "$fallback_start_port")"
    if "$health_check"; then
      echo "${label} host port ${current_port} is already serving ${healthy_name}; using ${fallback_port} for this repo."
    elif [[ "$mapped_host_port" == "$current_port" ]]; then
      echo "${label} mapped host port ${current_port} is not serving ${healthy_name} from localhost; using ${fallback_port} for this repo."
    else
      echo "${label} host port ${current_port} is in use by another process; using ${fallback_port}."
    fi
    printf -v "$env_var" '%s' "$fallback_port"
    export "$env_var"
    reserve_fallback_port "$fallback_port"
  fi
}

adopt_existing_mapped_host_port() {
  local env_var="$1"
  local service="$2"
  local container_port="$3"
  local provided="${4:-}"

  if [[ -n "$provided" ]]; then
    return 0
  fi

  local mapped_host_port
  mapped_host_port="$(compose_mapped_host_port "$service" "$container_port" || true)"
  if [[ -n "$mapped_host_port" ]]; then
    printf -v "$env_var" '%s' "$mapped_host_port"
    export "$env_var"
  fi
}

write_local_infra_env() {
  local env_file="$PROJECT_ROOT/.artifacts/local-infra.env"
  mkdir -p "$(dirname "$env_file")"
  cat >"$env_file" <<EOF
# Generated by scripts/start-dev-services.sh. Do not commit.
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}
POSTGRES_PORT=${POSTGRES_PORT}
REDIS_PORT=${REDIS_PORT}
OTEL_GRPC_PORT=${OTEL_GRPC_PORT}
OTEL_HTTP_PORT=${OTEL_HTTP_PORT}
OTEL_METRICS_PORT=${OTEL_METRICS_PORT}
OTEL_HEALTH_PORT=${OTEL_HEALTH_PORT}
PROMETHEUS_PORT=${PROMETHEUS_PORT}
NODE_EXPORTER_PORT=${NODE_EXPORTER_PORT}
GRAFANA_PORT=${GRAFANA_PORT}
JAEGER_UI_PORT=${JAEGER_UI_PORT}
JAEGER_OTLP_GRPC_PORT=${JAEGER_OTLP_GRPC_PORT}
JAEGER_OTLP_HTTP_PORT=${JAEGER_OTLP_HTTP_PORT}
LOKI_PORT=${LOKI_PORT}
LOKI_HOST_PORT=${LOKI_HOST_PORT}
SPOTLIGHT_PORT=${SPOTLIGHT_PORT}
LANGFUSE_PORT=${LANGFUSE_PORT}
LANGFUSE_WORKER_PORT=${LANGFUSE_WORKER_PORT}
LANGFUSE_CLICKHOUSE_HTTP_PORT=${LANGFUSE_CLICKHOUSE_HTTP_PORT}
LANGFUSE_CLICKHOUSE_TCP_PORT=${LANGFUSE_CLICKHOUSE_TCP_PORT}
LANGFUSE_MINIO_PORT=${LANGFUSE_MINIO_PORT}
LANGFUSE_MINIO_CONSOLE_PORT=${LANGFUSE_MINIO_CONSOLE_PORT}
COMPOSE_SKIP_OBSERVABILITY=${COMPOSE_SKIP_OBSERVABILITY:-false}
COMPOSE_SKIP_OTEL_COLLECTOR=${COMPOSE_SKIP_OTEL_COLLECTOR:-false}
COMPOSE_SKIP_REDIS=${COMPOSE_SKIP_REDIS:-false}
COMPOSE_SKIP_SPOTLIGHT=${COMPOSE_SKIP_SPOTLIGHT:-false}
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${OTEL_HTTP_PORT}
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${OTEL_HTTP_PORT}
EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${OTEL_HTTP_PORT}
JAEGER_API_URL=http://localhost:${JAEGER_UI_PORT}
PROMETHEUS_API_URL=http://localhost:${PROMETHEUS_PORT}
LOKI_API_URL=http://localhost:${LOKI_PORT}
EOF
}

adopt_existing_mapped_host_port "OTEL_GRPC_PORT" "otel-collector" "4317" "$OTEL_GRPC_PORT_PROVIDED"
adopt_existing_mapped_host_port "OTEL_HTTP_PORT" "otel-collector" "4318" "$OTEL_HTTP_PORT_PROVIDED"
adopt_existing_mapped_host_port "OTEL_METRICS_PORT" "otel-collector" "8888" "$OTEL_METRICS_PORT_PROVIDED"
adopt_existing_mapped_host_port "OTEL_HEALTH_PORT" "otel-collector" "13133" "$OTEL_HEALTH_PORT_PROVIDED"
adopt_existing_mapped_host_port "POSTGRES_PORT" "postgres" "5432" "$POSTGRES_PORT_PROVIDED"
adopt_existing_mapped_host_port "PROMETHEUS_PORT" "prometheus" "9090" "$PROMETHEUS_PORT_PROVIDED"
adopt_existing_mapped_host_port "NODE_EXPORTER_PORT" "node-exporter" "9100" "$NODE_EXPORTER_PORT_PROVIDED"
adopt_existing_mapped_host_port "GRAFANA_PORT" "grafana" "3000" "$GRAFANA_PORT_PROVIDED"
adopt_existing_mapped_host_port "JAEGER_UI_PORT" "jaeger" "16686" "$JAEGER_UI_PORT_PROVIDED"
adopt_existing_mapped_host_port "JAEGER_OTLP_GRPC_PORT" "jaeger" "4317" "$JAEGER_OTLP_GRPC_PORT_PROVIDED"
adopt_existing_mapped_host_port "JAEGER_OTLP_HTTP_PORT" "jaeger" "4318" "$JAEGER_OTLP_HTTP_PORT_PROVIDED"
adopt_existing_mapped_host_port "LOKI_PORT" "loki" "3100" "$LOKI_PORT_PROVIDED"
LOKI_HOST_PORT="$LOKI_PORT"
export LOKI_HOST_PORT
adopt_existing_mapped_host_port "REDIS_PORT" "redis" "6379" "$REDIS_PORT_PROVIDED"
adopt_existing_mapped_host_port "LANGFUSE_PORT" "langfuse-web" "3000" "$LANGFUSE_PORT_PROVIDED"
adopt_existing_mapped_host_port "LANGFUSE_WORKER_PORT" "langfuse-worker" "3030" "$LANGFUSE_WORKER_PORT_PROVIDED"
adopt_existing_mapped_host_port "LANGFUSE_CLICKHOUSE_HTTP_PORT" "langfuse-clickhouse" "8123" "$LANGFUSE_CLICKHOUSE_HTTP_PORT_PROVIDED"
adopt_existing_mapped_host_port "LANGFUSE_CLICKHOUSE_TCP_PORT" "langfuse-clickhouse" "9000" "$LANGFUSE_CLICKHOUSE_TCP_PORT_PROVIDED"
adopt_existing_mapped_host_port "LANGFUSE_MINIO_PORT" "langfuse-minio" "9000" "$LANGFUSE_MINIO_PORT_PROVIDED"
adopt_existing_mapped_host_port "LANGFUSE_MINIO_CONSOLE_PORT" "langfuse-minio" "9001" "$LANGFUSE_MINIO_CONSOLE_PORT_PROVIDED"

COMPOSE_SKIP_OBSERVABILITY="${COMPOSE_SKIP_OBSERVABILITY:-false}"
if [[ "$COMPOSE_SKIP_OBSERVABILITY" == "true" ]]; then
  echo "COMPOSE_SKIP_OBSERVABILITY=true; skipping local observability containers."
elif repo_observability_stack_healthy; then
  echo "Existing tx-agent-kit observability stack is healthy; using it and skipping local observability containers."
  COMPOSE_SKIP_OBSERVABILITY="true"
elif external_observability_stack_healthy; then
  echo "Existing observability stack is healthy; using it and skipping local observability containers."
  COMPOSE_SKIP_OBSERVABILITY="true"
else
  maybe_fallback_plain_host_port "OTEL_GRPC_PORT" "OpenTelemetry Collector gRPC" "otel-collector" "4317"
  maybe_fallback_plain_host_port "OTEL_HTTP_PORT" "OpenTelemetry Collector HTTP" "otel-collector" "4318"
  maybe_fallback_plain_host_port "OTEL_METRICS_PORT" "OpenTelemetry Collector metrics" "otel-collector" "8888"
  maybe_fallback_plain_host_port "OTEL_HEALTH_PORT" "OpenTelemetry Collector health" "otel-collector" "13133"
  maybe_fallback_http_service_host_port "GRAFANA_PORT" "Grafana" "Grafana" "grafana" "3000" "check_grafana"
  maybe_fallback_http_service_host_port "PROMETHEUS_PORT" "Prometheus" "Prometheus" "prometheus" "9090" "check_prometheus"
  maybe_fallback_plain_host_port "NODE_EXPORTER_PORT" "Node exporter" "node-exporter" "9100"
  maybe_fallback_http_service_host_port "JAEGER_UI_PORT" "Jaeger" "Jaeger" "jaeger" "16686" "check_jaeger"
  maybe_fallback_http_service_host_port "LOKI_PORT" "Loki" "Loki" "loki" "3100" "check_loki"
  LOKI_HOST_PORT="$LOKI_PORT"
  export LOKI_HOST_PORT
  maybe_fallback_plain_host_port "JAEGER_OTLP_GRPC_PORT" "Jaeger OTLP gRPC" "jaeger" "4317"
  maybe_fallback_plain_host_port "JAEGER_OTLP_HTTP_PORT" "Jaeger OTLP HTTP" "jaeger" "4318"
fi

echo "Checking local infrastructure health..."
if all_healthy; then
  ensure_langfuse_bootstrap
  write_local_infra_env
  echo "Infrastructure already healthy (shared across worktrees)."
  exit 0
fi

if ! docker_daemon_ready; then
  echo "Docker is not running. Start Docker first."
  exit 1
fi

maybe_fallback_plain_host_port "LANGFUSE_CLICKHOUSE_HTTP_PORT" "Langfuse ClickHouse HTTP" "langfuse-clickhouse" "8123"
maybe_fallback_plain_host_port "LANGFUSE_CLICKHOUSE_TCP_PORT" "Langfuse ClickHouse TCP" "langfuse-clickhouse" "9000"
maybe_fallback_plain_host_port "LANGFUSE_MINIO_PORT" "Langfuse MinIO API" "langfuse-minio" "9000"
maybe_fallback_plain_host_port "LANGFUSE_MINIO_CONSOLE_PORT" "Langfuse MinIO console" "langfuse-minio" "9001"
maybe_fallback_http_service_host_port "LANGFUSE_PORT" "Langfuse web" "Langfuse web" "langfuse-web" "3000" "check_langfuse_web"
maybe_fallback_http_service_host_port "LANGFUSE_WORKER_PORT" "Langfuse worker" "Langfuse worker" "langfuse-worker" "3030" "check_langfuse_worker"
maybe_fallback_plain_host_port "POSTGRES_PORT" "Postgres" "postgres" "5432"

COMPOSE_SKIP_OTEL_COLLECTOR="false"
if [[ "$COMPOSE_SKIP_OBSERVABILITY" == "true" ]]; then
  COMPOSE_SKIP_OTEL_COLLECTOR="true"
elif [[ "${TX_ALLOW_EXTERNAL_OTEL_COLLECTOR:-0}" == "1" ]] && check_otel; then
  echo "OpenTelemetry Collector already responding on port ${OTEL_HEALTH_PORT}; using it and skipping the otel-collector container."
  COMPOSE_SKIP_OTEL_COLLECTOR="true"
else
  assert_port_not_conflicted "otel-collector" "4317" "$OTEL_GRPC_PORT" "OpenTelemetry Collector gRPC"
  assert_port_not_conflicted "otel-collector" "4318" "$OTEL_HTTP_PORT" "OpenTelemetry Collector HTTP"
  assert_port_not_conflicted "otel-collector" "8888" "$OTEL_METRICS_PORT" "OpenTelemetry Collector metrics"
  assert_port_not_conflicted "otel-collector" "13133" "$OTEL_HEALTH_PORT" "OpenTelemetry Collector health"
fi
COMPOSE_SKIP_REDIS="false"
if check_host_redis; then
  echo "External Redis already responding on port ${REDIS_PORT}; skipping the redis container."
  COMPOSE_SKIP_REDIS="true"
else
  maybe_fallback_plain_host_port "REDIS_PORT" "Redis" "redis" "6379"
  assert_port_not_conflicted "redis" "6379" "$REDIS_PORT" "Redis"
fi
if [[ "$COMPOSE_SKIP_OBSERVABILITY" != "true" ]]; then
  assert_port_not_conflicted "prometheus" "9090" "$PROMETHEUS_PORT" "Prometheus"
  assert_port_not_conflicted "node-exporter" "9100" "$NODE_EXPORTER_PORT" "Node exporter"
  assert_port_not_conflicted "jaeger" "16686" "$JAEGER_UI_PORT" "Jaeger"
  assert_port_not_conflicted "loki" "3100" "$LOKI_PORT" "Loki"
fi
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
  maybe_restart_langfuse_web_once

  if all_healthy; then
    ensure_langfuse_bootstrap
    write_local_infra_env
    echo "Infrastructure is ready."
    echo "Grafana:      http://localhost:${GRAFANA_PORT}"
    echo "Postgres:     localhost:${POSTGRES_PORT}"
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
  loki_body="$(curl -sS -L --connect-timeout 1 --max-time 2 "http://127.0.0.1:${LOKI_PORT}/ready" 2>&1 || true)"
  echo "    /ready response preview: $(printf '%s' "$loki_body" | head -c 160)"
  if [[ "$loki_body" == *"<html"* || "$loki_body" == *"<!DOCTYPE"* ]]; then
    echo
    echo "Loki host port ${LOKI_PORT} appears to be hijacked by another process."
    echo "Another listener (probably a Next.js dev server from a different project) is answering"
    echo "on this port, so Loki's Docker forward is shadowed."
    echo
    echo "Diagnose:   lsof -P -iTCP:${LOKI_PORT} -sTCP:LISTEN"
    echo "Fix:        LOKI_HOST_PORT=3101 pnpm infra:ensure"
    echo "            LOKI_PORT=3101 pnpm test:integration"
  fi
fi

echo
echo "Inspect logs with: docker compose -p $COMPOSE_PROJECT_NAME logs"
exit 1
