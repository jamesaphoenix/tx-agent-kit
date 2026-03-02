#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

cd "$PROJECT_ROOT"

require_guard
require_tool gcloud
require_tool docker
require_tool pnpm
require_tool curl

collector_started=0
gke_cluster_created=0
gke_release_deployed=0
runtime_overrides_file=""

GCP_PROJECT_ID="${GCP_PROJECT_ID:-}"
GKE_CLUSTER="${GKE_CLUSTER:-}"
GKE_LOCATION="${GKE_LOCATION:-}"
GKE_LOCATION_FLAG=""
K8S_CONTEXT_GKE=""
K8S_NAMESPACE_GKE="${K8S_NAMESPACE_GKE:-${K8S_NAMESPACE_GKE_STAGING:-tx-agent-kit-otel-e2e}}"
HELM_RELEASE_GKE="${HELM_RELEASE_GKE:-${HELM_RELEASE_GKE_STAGING:-tx-agent-kit-otel-e2e}}"

cleanup() {
  local cleanup_failures=0

  if [[ "$collector_started" -eq 1 ]]; then
    docker compose \
      -f "$PROJECT_ROOT/docker-compose.gcp-e2e.yml" \
      --env-file "$GCP_RENDERED_DIR/gcp-e2e.env" \
      down -v >/dev/null 2>&1 || {
      echo "Failed to tear down local OTEL collector compose stack."
      cleanup_failures=1
    }
  fi

  if [[ "${KEEP_GKE_DEPLOYMENT:-0}" != "1" && ( "$gke_release_deployed" -eq 1 || "${DELETE_EXISTING_GKE_RELEASE_ON_EXIT:-0}" == "1" ) && -n "$K8S_CONTEXT_GKE" && -n "$K8S_NAMESPACE_GKE" && -n "$HELM_RELEASE_GKE" ]]; then
    if helm status "$HELM_RELEASE_GKE" --kube-context "$K8S_CONTEXT_GKE" --namespace "$K8S_NAMESPACE_GKE" >/dev/null 2>&1; then
      helm uninstall "$HELM_RELEASE_GKE" \
        --kube-context "$K8S_CONTEXT_GKE" \
        --namespace "$K8S_NAMESPACE_GKE" >/dev/null 2>&1 || {
        echo "Failed to uninstall temporary GKE Helm release '$HELM_RELEASE_GKE'."
        cleanup_failures=1
      }
    fi
  fi

  if [[ "${KEEP_GKE_CLUSTER:-0}" != "1" && ( "$gke_cluster_created" -eq 1 || "${DELETE_EXISTING_GKE_CLUSTER_ON_EXIT:-0}" == "1" ) && -n "$GKE_CLUSTER" && -n "$GKE_LOCATION" && -n "$GKE_LOCATION_FLAG" && -n "$GCP_PROJECT_ID" ]]; then
    if gcloud container clusters describe "$GKE_CLUSTER" "$GKE_LOCATION_FLAG" "$GKE_LOCATION" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
      gcloud container clusters delete "$GKE_CLUSTER" \
        "$GKE_LOCATION_FLAG" "$GKE_LOCATION" \
        --project "$GCP_PROJECT_ID" \
        --quiet >/dev/null 2>&1 || {
        echo "Failed to delete temporary GKE cluster '$GKE_CLUSTER'."
        cleanup_failures=1
      }
    fi
  fi

  if [[ "${KEEP_GCP_TOY_PROJECT:-0}" != "1" && -n "$GCP_PROJECT_ID" ]]; then
    if [[ "$GCP_PROJECT_ID" != txak-otel-* && "${ALLOW_NONTOY_PROJECT_TEARDOWN:-0}" != "1" ]]; then
      echo "Refusing to teardown non-toy project id '$GCP_PROJECT_ID'. Set ALLOW_NONTOY_PROJECT_TEARDOWN=1 to override."
      cleanup_failures=1
    elif gcloud projects describe "$GCP_PROJECT_ID" >/dev/null 2>&1; then
      RUN_GCP_E2E=1 GCP_PROJECT_ID="$GCP_PROJECT_ID" "$SCRIPT_DIR/teardown-toy-project.sh" >/dev/null 2>&1 || {
        echo "Failed to request deletion of temporary GCP project '$GCP_PROJECT_ID'."
        cleanup_failures=1
      }
    fi
  fi

  if [[ "${KEEP_GCP_TOY_PROJECT:-0}" != "1" ]]; then
    rm -f "$GCP_RENDERED_DIR/gcp-e2e.env" "$GCP_RENDERED_DIR/toy-project.env"
    if [[ -n "$runtime_overrides_file" ]]; then
      rm -f "$runtime_overrides_file"
    fi
    if [[ -n "${OTEL_COLLECTOR_KEY_FILE:-}" ]]; then
      rm -f "$OTEL_COLLECTOR_KEY_FILE"
    fi
  fi

  if [[ "$cleanup_failures" -ne 0 ]]; then
    echo "Cleanup failed; temporary resources may have leaked."
    return 1
  fi
}
trap cleanup EXIT

if [[ -z "${GCP_TOY_PROJECT_ID:-}" ]]; then
  GCP_TOY_PROJECT_ID="$(resolve_toy_project_id)"
fi
if [[ "$GCP_TOY_PROJECT_ID" != txak-otel-* && "${ALLOW_NONTOY_PROJECT_TEARDOWN:-0}" != "1" ]]; then
  echo "GCP_TOY_PROJECT_ID must start with txak-otel- (or set ALLOW_NONTOY_PROJECT_TEARDOWN=1)."
  exit 1
fi
export GCP_TOY_PROJECT_ID
GCP_PROJECT_ID="$GCP_TOY_PROJECT_ID"

RUN_GCP_E2E=1 GCP_TOY_PROJECT_ID="$GCP_TOY_PROJECT_ID" "$SCRIPT_DIR/bootstrap-toy-project.sh"

if [[ ! -f "$GCP_RENDERED_DIR/toy-project.env" ]]; then
  echo "Missing toy project metadata file: $GCP_RENDERED_DIR/toy-project.env"
  exit 1
fi

# shellcheck disable=SC1090
source "$GCP_RENDERED_DIR/toy-project.env"
require_env GCP_PROJECT_ID
require_env OTEL_COLLECTOR_KEY_FILE

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

if [[ "${RUN_GKE_OTEL_DEPLOY_E2E:-0}" == "1" ]]; then
  require_tool kubectl
  require_tool helm
  require_tool op
  require_tool openssl

  if ! op whoami >/dev/null 2>&1; then
    echo "RUN_GKE_OTEL_DEPLOY_E2E=1 requires a signed-in 1Password CLI session for deploy templates."
    exit 1
  fi

  GKE_LOCATION="${GKE_LOCATION:-us-central1}"
  GKE_LOCATION_TYPE="${GKE_LOCATION_TYPE:-region}"

  case "$GKE_LOCATION_TYPE" in
    region)
      GKE_LOCATION_FLAG="--region"
      ;;
    zone)
      GKE_LOCATION_FLAG="--zone"
      ;;
    *)
      echo "Invalid GKE_LOCATION_TYPE '$GKE_LOCATION_TYPE'. Expected 'region' or 'zone'."
      exit 1
      ;;
  esac

  if [[ "${GKE_E2E_CREATE_CLUSTER:-1}" == "1" ]]; then
    GKE_CLUSTER="${GKE_CLUSTER:-txak-otel-gke-$(random_suffix)}"
    echo "Creating temporary GKE cluster '$GKE_CLUSTER' (${GKE_LOCATION_TYPE}: ${GKE_LOCATION})"
    gcloud container clusters create-auto "$GKE_CLUSTER" \
      "$GKE_LOCATION_FLAG" "$GKE_LOCATION" \
      --project "$GCP_PROJECT_ID" \
      --quiet
    gke_cluster_created=1
  else
    require_env GKE_CLUSTER
    GKE_CLUSTER="$GKE_CLUSTER"
    if [[ "${DELETE_EXISTING_GKE_CLUSTER_ON_EXIT:-0}" != "1" ]]; then
      echo "Using existing GKE cluster; cleanup will not delete it."
    fi
  fi

  gcloud container clusters get-credentials "$GKE_CLUSTER" \
    "$GKE_LOCATION_FLAG" "$GKE_LOCATION" \
    --project "$GCP_PROJECT_ID"
  K8S_CONTEXT_GKE="$(kubectl config current-context)"

  export K8S_CONTEXT_GKE
  export K8S_NAMESPACE_GKE
  export HELM_RELEASE_GKE
  export K8S_NAMESPACE_GKE_STAGING="$K8S_NAMESPACE_GKE"
  export HELM_RELEASE_GKE_STAGING="$HELM_RELEASE_GKE"

  artifact_region="${ARTIFACT_REGISTRY_REGION:-us-central1}"
  artifact_repository="${ARTIFACT_REGISTRY_REPOSITORY:-tx-agent-kit}"

  if ! gcloud artifacts repositories describe "$artifact_repository" \
    --location "$artifact_region" \
    --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$artifact_repository" \
      --repository-format=docker \
      --location "$artifact_region" \
      --description="tx-agent-kit temporary e2e repository" \
      --project "$GCP_PROJECT_ID"
  fi

  gcloud auth configure-docker "${artifact_region}-docker.pkg.dev" --quiet

  PUSH_IMAGES=1 \
  GCP_PROJECT_ID="$GCP_PROJECT_ID" \
  ARTIFACT_REGISTRY_REGION="$artifact_region" \
  ARTIFACT_REGISTRY_REPOSITORY="$artifact_repository" \
  pnpm deploy:build-images

  artifact_file="$(ls -t "$PROJECT_ROOT"/deploy/artifacts/images-*.env | head -n 1)"
  echo "Deploying image artifact to GKE: $artifact_file"

  runtime_overrides_file="$(mktemp "$GCP_RENDERED_DIR/gke-runtime-overrides.XXXXXX.env")"
  cat > "$runtime_overrides_file" <<EOF
GOOGLE_CLOUD_PROJECT=$GCP_PROJECT_ID
NODE_ENV=gke-e2e
OTEL_SERVICE_NAMESPACE=tx-agent-kit
EOF

  RUNTIME_ENV_OVERRIDES_FILE="$runtime_overrides_file" \
  GKE_ENVIRONMENT="${GKE_ENVIRONMENT:-staging}" \
  pnpm deploy:k8s:gke "$artifact_file"
  gke_release_deployed=1
  rm -f "$runtime_overrides_file"
  runtime_overrides_file=""

  pnpm deploy:k8s:status gke

  gke_smoke_suffix="$(random_suffix)"
  gke_smoke_service_name="tx-agent-kit-gke-e2e-${gke_smoke_suffix}"
  gke_smoke_log_marker="observability.smoke.log.gke.${gke_smoke_suffix}"
  gke_trace_id="$(openssl rand -hex 16)"
  gke_span_id="$(openssl rand -hex 8)"
  gke_end_time_ns="$(date +%s%N)"
  gke_start_time_ns="$((gke_end_time_ns - 1000000))"

  smoke_pod="otel-smoke-${gke_smoke_suffix}"
  kubectl --context "$K8S_CONTEXT_GKE" -n "$K8S_NAMESPACE_GKE" run "$smoke_pod" \
    --image=curlimages/curl:8.12.1 \
    --restart=Never \
    --rm \
    --attach \
    --env="COLLECTOR_HOST=${HELM_RELEASE_GKE}-otel-collector" \
    --env="SMOKE_SERVICE_NAME=${gke_smoke_service_name}" \
    --env="SMOKE_LOG_MARKER=${gke_smoke_log_marker}" \
    --env="TRACE_ID=${gke_trace_id}" \
    --env="SPAN_ID=${gke_span_id}" \
    --env="START_NS=${gke_start_time_ns}" \
    --env="END_NS=${gke_end_time_ns}" \
    --command -- sh -ceu '
      collector="http://${COLLECTOR_HOST}:4318"

      cat > /tmp/traces.json <<EOF
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "${SMOKE_SERVICE_NAME}"}},
          {"key": "deployment.environment.name", "value": {"stringValue": "gke-e2e"}}
        ]
      },
      "scopeSpans": [
        {
          "scope": {"name": "gke-e2e-smoke"},
          "spans": [
            {
              "traceId": "${TRACE_ID}",
              "spanId": "${SPAN_ID}",
              "name": "observability.smoke.node",
              "kind": 2,
              "startTimeUnixNano": "${START_NS}",
              "endTimeUnixNano": "${END_NS}"
            }
          ]
        }
      ]
    }
  ]
}
EOF

      cat > /tmp/metrics.json <<EOF
{
  "resourceMetrics": [
    {
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "${SMOKE_SERVICE_NAME}"}}
        ]
      },
      "scopeMetrics": [
        {
          "scope": {"name": "gke-e2e-smoke"},
          "metrics": [
            {
              "name": "tx_agent_kit_node_service_startup_total",
              "sum": {
                "aggregationTemporality": 2,
                "isMonotonic": true,
                "dataPoints": [
                  {
                    "asInt": "1",
                    "timeUnixNano": "${END_NS}",
                    "attributes": [
                      {"key": "smoke_service", "value": {"stringValue": "${SMOKE_SERVICE_NAME}"}}
                    ]
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
EOF

      cat > /tmp/logs.json <<EOF
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "${SMOKE_SERVICE_NAME}"}}
        ]
      },
      "scopeLogs": [
        {
          "scope": {"name": "gke-e2e-smoke"},
          "logRecords": [
            {
              "timeUnixNano": "${END_NS}",
              "severityText": "INFO",
              "body": {"stringValue": "${SMOKE_LOG_MARKER}"}
            }
          ]
        }
      ]
    }
  ]
}
EOF

      curl -fsS -H "Content-Type: application/json" --data-binary @/tmp/traces.json "${collector}/v1/traces"
      curl -fsS -H "Content-Type: application/json" --data-binary @/tmp/metrics.json "${collector}/v1/metrics"
      curl -fsS -H "Content-Type: application/json" --data-binary @/tmp/logs.json "${collector}/v1/logs"
    '

  RUN_GCP_E2E=1 \
  GCP_PROJECT_ID="$GCP_PROJECT_ID" \
  SMOKE_SERVICE_NAME="$gke_smoke_service_name" \
  SMOKE_LOG_MARKER="$gke_smoke_log_marker" \
  VALIDATION_TIMEOUT_SECONDS="${GKE_SIGNAL_VALIDATION_TIMEOUT_SECONDS:-600}" \
  "$SCRIPT_DIR/validate-signals.sh"

  echo "GKE deploy + telemetry validation succeeded for context $K8S_CONTEXT_GKE"
fi

if [[ "${KEEP_GCP_TOY_PROJECT:-0}" == "1" ]]; then
  echo "Project retained for inspection: $GCP_PROJECT_ID"
else
  echo "Project will be deleted by cleanup trap."
fi
