#!/usr/bin/env bash
# Validate local Docker observability stack health.

set -euo pipefail

PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
JAEGER_UI_PORT="${JAEGER_UI_PORT:-16686}"
LOKI_PORT="${LOKI_PORT:-3100}"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"
OTEL_HEALTH_PORT="${OTEL_HEALTH_PORT:-13133}"
OTEL_HTTP_PORT="${OTEL_HTTP_PORT:-4320}"
OBSERVABILITY_RETRY_ATTEMPTS="${OBSERVABILITY_RETRY_ATTEMPTS:-30}"
OBSERVABILITY_RETRY_SLEEP_SECONDS="${OBSERVABILITY_RETRY_SLEEP_SECONDS:-2}"
OBSERVABILITY_CURL_CONNECT_TIMEOUT_SECONDS="${OBSERVABILITY_CURL_CONNECT_TIMEOUT_SECONDS:-2}"
OBSERVABILITY_CURL_MAX_TIME_SECONDS="${OBSERVABILITY_CURL_MAX_TIME_SECONDS:-5}"
SMOKE_LOG_MARKER="${OTEL_SMOKE_LOG_MARKER:-observability.smoke.log}"
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
require_tool node

curl_with_timeouts() {
  curl \
    --connect-timeout "$OBSERVABILITY_CURL_CONNECT_TIMEOUT_SECONDS" \
    --max-time "$OBSERVABILITY_CURL_MAX_TIME_SECONDS" \
    "$@"
}

wait_for_http_ok() {
  local url="$1"
  local attempts="$2"
  local sleep_seconds="$3"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl_with_timeouts -fsS "$url" >/dev/null; then
      return 0
    fi

    sleep "$sleep_seconds"
  done

  return 1
}

require_http_ok() {
  local name="$1"
  local url="$2"
  local attempts="$3"
  local sleep_seconds="$4"

  if ! wait_for_http_ok "$url" "$attempts" "$sleep_seconds"; then
    echo "Observability validation failed: ${name} endpoint did not become healthy: ${url}"
    exit 1
  fi
}

declare -a readiness_check_pids=()

require_http_ok_in_background() {
  local name="$1"
  local url="$2"
  local attempts="$3"
  local sleep_seconds="$4"

  (
    if wait_for_http_ok "$url" "$attempts" "$sleep_seconds"; then
      exit 0
    fi

    echo "Observability validation failed: ${name} endpoint did not become healthy: ${url}"
    exit 1
  ) &

  readiness_check_pids+=("$!")
}

jaeger_has_service() {
  local service_name="$1"
  local response

  response="$(curl_with_timeouts -fsS "http://localhost:${JAEGER_UI_PORT}/api/services")"
  RESPONSE_JSON="$response" TARGET_SERVICE="$service_name" node <<'NODE'
const payload = JSON.parse(process.env.RESPONSE_JSON ?? '{}')
const services = Array.isArray(payload.data) ? payload.data : []
const targetService = process.env.TARGET_SERVICE ?? ''
process.exit(services.includes(targetService) ? 0 : 1)
NODE
}

prometheus_query_positive() {
  local query="$1"
  local response
  response="$(curl_with_timeouts -fsS --get "http://localhost:${PROMETHEUS_PORT}/api/v1/query" --data-urlencode "query=${query}")"
  RESPONSE_JSON="$response" node <<'NODE'
const payload = JSON.parse(process.env.RESPONSE_JSON ?? '{}')
const rawValue = payload?.data?.result?.[0]?.value?.[1] ?? '0'
const measured = Number.parseFloat(rawValue)
process.exit(Number.isFinite(measured) && measured > 0 ? 0 : 1)
NODE
}

prometheus_metric_for_job_positive() {
  local metric_name="$1"
  local job_name="$2"
  prometheus_query_positive "{__name__=\"${metric_name}\",job=\"${job_name}\"}"
}

loki_has_smoke_log_for_service() {
  local service_name="$1"
  local selector="{service_name=\"${service_name}\"} |= \"${SMOKE_LOG_MARKER}\""
  local query="sum(count_over_time(${selector} [5m]))"
  local response
  response="$(curl_with_timeouts -sS --get "http://localhost:${LOKI_PORT}/loki/api/v1/query" --data-urlencode "query=${query}")"
  RESPONSE_JSON="$response" node <<'NODE'
let payload
try {
  payload = JSON.parse(process.env.RESPONSE_JSON ?? '{}')
} catch {
  process.exit(1)
}
const rawValue = payload?.data?.result?.[0]?.value?.[1] ?? '0'
const parsed = Number.parseFloat(rawValue)
process.exit(Number.isFinite(parsed) && parsed > 0 ? 0 : 1)
NODE
}

emit_smoke_telemetry() {
  local runtime_kind="$1"
  local service_name="$2"
  OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_HTTP_PORT}" \
    OTEL_LOGS_EXPORTER="otlp" \
    OTEL_SMOKE_LOG_MARKER="$SMOKE_LOG_MARKER" \
    pnpm exec tsx ./scripts/test/emit-observability-smoke.ts "$runtime_kind" "$service_name"
}

require_http_ok_in_background "Prometheus" "http://localhost:${PROMETHEUS_PORT}/-/healthy" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
require_http_ok_in_background "Jaeger" "http://localhost:${JAEGER_UI_PORT}" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
require_http_ok_in_background "Loki" "http://localhost:${LOKI_PORT}/ready" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
require_http_ok_in_background "Grafana" "http://localhost:${GRAFANA_PORT}/api/health" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
require_http_ok_in_background "OpenTelemetry Collector" "http://localhost:${OTEL_HEALTH_PORT}/health/status" "$OBSERVABILITY_RETRY_ATTEMPTS" "$OBSERVABILITY_RETRY_SLEEP_SECONDS"

readiness_failed=0
for check_pid in "${readiness_check_pids[@]}"; do
  if ! wait "$check_pid"; then
    readiness_failed=1
  fi
done

if [[ "$readiness_failed" -ne 0 ]]; then
  exit 1
fi

emit_smoke_telemetry node tx-agent-kit-api
emit_smoke_telemetry node tx-agent-kit-worker
emit_smoke_telemetry client tx-agent-kit-web
emit_smoke_telemetry client tx-agent-kit-mobile

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
    prometheus_metric_for_job_positive "tx_agent_kit_node_service_startup_total" "tx-agent-kit/tx-agent-kit-worker" &&
    loki_has_smoke_log_for_service "tx-agent-kit-api" &&
    loki_has_smoke_log_for_service "tx-agent-kit-worker"; then
    echo "Observability stack healthy and ingesting smoke telemetry."
    exit 0
  fi

  sleep "$OBSERVABILITY_RETRY_SLEEP_SECONDS"
done

echo "Observability validation failed: smoke telemetry was not observed in Jaeger/Prometheus/Loki."
exit 1
