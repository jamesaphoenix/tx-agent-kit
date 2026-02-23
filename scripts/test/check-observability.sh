#!/usr/bin/env bash
# Validate local Docker observability stack health.

set -euo pipefail

PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
JAEGER_UI_PORT="${JAEGER_UI_PORT:-16686}"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"
OTEL_HEALTH_PORT="${OTEL_HEALTH_PORT:-13133}"
OTEL_HTTP_PORT="${OTEL_HTTP_PORT:-4320}"
OBSERVABILITY_RETRY_ATTEMPTS="${OBSERVABILITY_RETRY_ATTEMPTS:-30}"
OBSERVABILITY_RETRY_SLEEP_SECONDS="${OBSERVABILITY_RETRY_SLEEP_SECONDS:-2}"
REQUIRED_JAEGER_SERVICES=(
  "tx-agent-kit-api"
  "tx-agent-kit-worker"
  "tx-agent-kit-web"
  "tx-agent-kit-mobile"
)

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool"
    exit 1
  fi
}

require_tool curl
require_tool jq
require_tool awk

wait_for_http_ok() {
  local url="$1"
  local attempts="$2"
  local sleep_seconds="$3"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS "$url" >/dev/null; then
      return 0
    fi

    sleep "$sleep_seconds"
  done

  return 1
}

jaeger_has_service() {
  local service_name="$1"

  curl -fsS "http://localhost:${JAEGER_UI_PORT}/api/services" \
    | jq -e --arg service "$service_name" '.data | index($service) != null' >/dev/null
}

prometheus_query_positive() {
  local query="$1"

  local response
  response="$(curl -fsS --get "http://localhost:${PROMETHEUS_PORT}/api/v1/query" --data-urlencode "query=${query}")"
  local value
  value="$(echo "$response" | jq -r '.data.result[0].value[1] // "0"')"
  awk -v measured="$value" 'BEGIN { exit !(measured + 0 > 0) }'
}

prometheus_metric_for_job_positive() {
  local metric_name="$1"
  local job_name="$2"
  prometheus_query_positive "{__name__=\"${metric_name}\",job=\"${job_name}\"}"
}

wait_for_http_ok "http://localhost:${PROMETHEUS_PORT}/-/healthy" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
wait_for_http_ok "http://localhost:${JAEGER_UI_PORT}" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
wait_for_http_ok "http://localhost:${GRAFANA_PORT}/api/health" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
wait_for_http_ok "http://localhost:${OTEL_HEALTH_PORT}/health/status" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"

OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_HTTP_PORT}" pnpm exec tsx ./scripts/test/emit-observability-smoke.ts node tx-agent-kit-api
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_HTTP_PORT}" pnpm exec tsx ./scripts/test/emit-observability-smoke.ts node tx-agent-kit-worker
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_HTTP_PORT}" pnpm exec tsx ./scripts/test/emit-observability-smoke.ts client tx-agent-kit-web
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_HTTP_PORT}" pnpm exec tsx ./scripts/test/emit-observability-smoke.ts client tx-agent-kit-mobile

for ((attempt = 1; attempt <= OBSERVABILITY_RETRY_ATTEMPTS; attempt += 1)); do
  all_services_present=true
  for required_service in "${REQUIRED_JAEGER_SERVICES[@]}"; do
    if ! jaeger_has_service "$required_service"; then
      all_services_present=false
      break
    fi
  done

  if [ "$all_services_present" = true ] &&
    prometheus_metric_for_job_positive "tx_agent_kit_client_http_request_total" "tx-agent-kit/tx-agent-kit-web" &&
    prometheus_metric_for_job_positive "tx_agent_kit_client_http_request_total" "tx-agent-kit/tx-agent-kit-mobile" &&
    prometheus_metric_for_job_positive "tx_agent_kit_node_service_startup_total" "tx-agent-kit/tx-agent-kit-api" &&
    prometheus_metric_for_job_positive "tx_agent_kit_node_service_startup_total" "tx-agent-kit/tx-agent-kit-worker"; then
    echo "Observability stack healthy and ingesting smoke telemetry."
    exit 0
  fi

  sleep "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
done

echo "Observability validation failed: smoke telemetry was not observed in Jaeger/Prometheus."
exit 1
