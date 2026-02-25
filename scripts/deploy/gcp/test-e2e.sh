#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

require_guard
require_tool gcloud
require_tool docker
require_tool pnpm
require_tool curl

project_bootstrapped=0
collector_started=0

cleanup() {
  if [[ "$collector_started" -eq 1 ]]; then
    docker compose \
      -f "$PROJECT_ROOT/docker-compose.gcp-e2e.yml" \
      --env-file "$GCP_RENDERED_DIR/gcp-e2e.env" \
      down -v >/dev/null 2>&1 || true
  fi

  if [[ "${KEEP_GCP_TOY_PROJECT:-0}" != "1" && "$project_bootstrapped" -eq 1 ]]; then
    RUN_GCP_E2E=1 GCP_PROJECT_ID="$GCP_PROJECT_ID" "$SCRIPT_DIR/teardown-toy-project.sh" >/dev/null 2>&1 || true
  fi

  if [[ "${KEEP_GCP_TOY_PROJECT:-0}" != "1" ]]; then
    rm -f "$GCP_RENDERED_DIR/gcp-e2e.env" "$GCP_RENDERED_DIR/toy-project.env"
    if [[ -n "${OTEL_COLLECTOR_KEY_FILE:-}" ]]; then
      rm -f "$OTEL_COLLECTOR_KEY_FILE"
    fi
  fi
}
trap cleanup EXIT

RUN_GCP_E2E=1 "$SCRIPT_DIR/bootstrap-toy-project.sh"

if [[ ! -f "$GCP_RENDERED_DIR/toy-project.env" ]]; then
  echo "Missing toy project metadata file: $GCP_RENDERED_DIR/toy-project.env"
  exit 1
fi

# shellcheck disable=SC1090
source "$GCP_RENDERED_DIR/toy-project.env"
require_env GCP_PROJECT_ID
require_env OTEL_COLLECTOR_KEY_FILE
project_bootstrapped=1

credentials_dir="${OTEL_COLLECTOR_GCP_CREDENTIALS_DIR:-$(dirname "$OTEL_COLLECTOR_KEY_FILE")}"
credentials_basename="$(basename "$OTEL_COLLECTOR_KEY_FILE")"
credentials_container_path="/var/secrets/google/${credentials_basename}"

if [[ ! -f "$OTEL_COLLECTOR_KEY_FILE" ]]; then
  echo "Expected OTEL collector key file at $OTEL_COLLECTOR_KEY_FILE"
  exit 1
fi

otlp_http_port="${OTEL_E2E_OTLP_HTTP_PORT:-14318}"
otlp_grpc_port="${OTEL_E2E_OTLP_GRPC_PORT:-14317}"
health_port="${OTEL_E2E_HEALTH_PORT:-14333}"
smoke_suffix="$(random_suffix)"
SMOKE_SERVICE_NAME="tx-agent-kit-gcp-e2e-${smoke_suffix}"
SMOKE_LOG_MARKER="observability.smoke.log.${smoke_suffix}"

cat > "$GCP_RENDERED_DIR/gcp-e2e.env" <<ENVFILE
GOOGLE_CLOUD_PROJECT=$GCP_PROJECT_ID
GOOGLE_APPLICATION_CREDENTIALS=$credentials_container_path
OTEL_COLLECTOR_GCP_CREDENTIALS_DIR=$credentials_dir
OTEL_COLLECTOR_GCLOUD_CONFIG_DIR=${OTEL_COLLECTOR_GCLOUD_CONFIG_DIR:-$PROJECT_ROOT/deploy/gcloud-empty}
OTEL_E2E_OTLP_HTTP_PORT=$otlp_http_port
OTEL_E2E_OTLP_GRPC_PORT=$otlp_grpc_port
OTEL_E2E_HEALTH_PORT=$health_port
ENVFILE

collector_started=1
docker compose \
  -f "$PROJECT_ROOT/docker-compose.gcp-e2e.yml" \
  --env-file "$GCP_RENDERED_DIR/gcp-e2e.env" \
  up -d --remove-orphans

for ((attempt = 1; attempt <= 60; attempt += 1)); do
  if curl -fsS "http://localhost:${health_port}/health/status" >/dev/null 2>&1; then
    break
  fi

  if [[ "$attempt" -eq 60 ]]; then
    echo "OTEL collector did not become healthy within timeout."
    exit 1
  fi

  sleep 2
done

OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${otlp_http_port}" \
OTEL_LOGS_EXPORTER="otlp" \
OTEL_SMOKE_LOG_MARKER="$SMOKE_LOG_MARKER" \
pnpm exec tsx "$PROJECT_ROOT/scripts/test/emit-observability-smoke.ts" node "$SMOKE_SERVICE_NAME"

RUN_GCP_E2E=1 \
GCP_PROJECT_ID="$GCP_PROJECT_ID" \
SMOKE_SERVICE_NAME="$SMOKE_SERVICE_NAME" \
SMOKE_LOG_MARKER="$SMOKE_LOG_MARKER" \
"$SCRIPT_DIR/validate-signals.sh"

echo "GCP telemetry E2E succeeded for project $GCP_PROJECT_ID"
if [[ "${KEEP_GCP_TOY_PROJECT:-0}" == "1" ]]; then
  echo "Project retained for inspection: $GCP_PROJECT_ID"
else
  echo "Project will be deleted by cleanup trap."
fi
