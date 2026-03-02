#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=../../lib/lock.sh
source "$SCRIPT_DIR/../../lib/lock.sh"

cd "$PROJECT_ROOT"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd"
    exit 1
  fi
}

require_cmd pnpm
require_cmd kubectl
require_cmd helm
require_cmd curl
require_cmd op

ARTIFACT_FILE="${1:-}"
if [[ -z "$ARTIFACT_FILE" ]]; then
  ARTIFACT_FILE="$(ls -t deploy/artifacts/images-*.env 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$ARTIFACT_FILE" ]]; then
  echo "No image artifact found. Pass a file path or run PUSH_IMAGES=1 pnpm deploy:build-images first."
  exit 1
fi

"$SCRIPT_DIR/verify-artifact.sh" "$ARTIFACT_FILE"

EXPECTED_API_IMAGE=""
EXPECTED_WORKER_IMAGE=""
while IFS='=' read -r key value; do
  case "$key" in
    API_IMAGE)
      EXPECTED_API_IMAGE="$value"
      ;;
    WORKER_IMAGE)
      EXPECTED_WORKER_IMAGE="$value"
      ;;
  esac
done < <("$SCRIPT_DIR/load-image-artifact.sh" "$ARTIFACT_FILE")

if [[ -z "$EXPECTED_API_IMAGE" || -z "$EXPECTED_WORKER_IMAGE" ]]; then
  echo "Artifact did not resolve expected API/worker images."
  exit 1
fi

bootstrap_output="$("$SCRIPT_DIR/bootstrap-k3s.sh")"
bootstrap_context="$(echo "$bootstrap_output" | awk -F= '/^K8S_BOOTSTRAP_CONTEXT=/{print $2; exit}')"
if [[ -n "$bootstrap_context" ]]; then
  export K8S_CONTEXT_MAC="$bootstrap_context"
fi

KUBE_CONTEXT="${K8S_CONTEXT_MAC:-${K8S_CONTEXT:-k3s}}"
NAMESPACE="${K8S_NAMESPACE_MAC_STAGING:-tx-staging}"
RELEASE="${HELM_RELEASE_MAC_STAGING:-tx-agent-kit-staging}"
TEMPLATE_FILE="deploy/env/staging.env.template"
LOCK_DIR="${DEPLOY_LOCK_DIR:-/tmp/tx-agent-kit-deploy-mac-staging.lock}"
LOCK_TIMEOUT_SECONDS="${DEPLOY_LOCK_TIMEOUT_SECONDS:-900}"
LOCK_MISSING_PID_GRACE_SECONDS="${DEPLOY_LOCK_MISSING_PID_GRACE_SECONDS:-30}"
before_manifest=""
after_manifest=""
expected_env_file=""

if ! lock_acquire "$LOCK_DIR" "$LOCK_TIMEOUT_SECONDS" "$LOCK_MISSING_PID_GRACE_SECONDS"; then
  echo "Another staging deploy verification is already in progress."
  exit 1
fi

cleanup() {
  rm -f "${before_manifest:-}" "${after_manifest:-}" "${expected_env_file:-}"
  lock_release "$LOCK_DIR"
}
trap cleanup EXIT

retry_cmd() {
  local attempts="$1"
  local sleep_seconds="$2"
  shift 2

  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if "$@"; then
      return 0
    fi

    if [[ "$attempt" -lt "$attempts" ]]; then
      sleep "$sleep_seconds"
    fi
  done

  return 1
}

extract_env_value() {
  local file="$1"
  local key="$2"
  local value
  value="$(awk -F= -v wanted_key="$key" '$1 == wanted_key {sub(/^[^=]*=/, ""); print; exit}' "$file")"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s\n' "$value"
}

select_running_pod() {
  local selector="$1"

  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" wait pod \
    -l "$selector" \
    --for=condition=Ready \
    --timeout="${K8S_POD_READY_TIMEOUT:-300s}" >/dev/null

  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get pods \
    -l "$selector" \
    --field-selector=status.phase=Running \
    --sort-by=.metadata.creationTimestamp \
    -o jsonpath='{.items[-1:].metadata.name}'
}

wait_release_running_pods() {
  local ready_timeout="${K8S_POD_READY_TIMEOUT:-300s}"
  local -a release_running_pods=()
  while IFS= read -r pod_name; do
    if [[ -n "$pod_name" ]]; then
      release_running_pods+=("$pod_name")
    fi
  done < <(
    kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get pods \
      -l "app.kubernetes.io/instance=${RELEASE}" \
      --field-selector=status.phase=Running \
      -o name
  )

  if [[ "${#release_running_pods[@]}" -eq 0 ]]; then
    echo "No running pods found for release ${RELEASE} in ${NAMESPACE}."
    exit 1
  fi

  for pod_name in "${release_running_pods[@]}"; do
    kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" wait "$pod_name" --for=condition=Ready --timeout="$ready_timeout"
  done
}

has_api_endpoints() {
  local endpoints
  endpoints="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get endpoints "${RELEASE}-api" -o jsonpath='{.subsets[*].addresses[*].ip}' || true)"
  [[ -n "$endpoints" ]]
}

external_health_ok() {
  local base_url="$1"
  local response
  response="$(curl -fsS --max-time 20 "${base_url%/}/health" || true)"
  [[ "$response" =~ \"status\"[[:space:]]*:[[:space:]]*\"healthy\" ]]
}

emit_diagnostics() {
  echo "----- k3s staging diagnostics (${KUBE_CONTEXT}/${NAMESPACE}) -----"
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment,pod,svc,ingress || true
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 120 || true
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" logs "deployment/${RELEASE}-api" --tail=120 || true
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" logs "deployment/${RELEASE}-worker" --tail=120 || true
  echo "----- end diagnostics -----"
}

trap emit_diagnostics ERR

echo "Deploying staging release to Mac k3s using artifact: $ARTIFACT_FILE"
RUN_TUNNEL_CHECK_SOFT_FAIL=0 \
REQUIRE_SMOKE=1 \
RUN_SMOKE=1 \
RUN_TUNNEL_RECONCILE=1 \
RUN_TUNNEL_CHECK=1 \
TUNNEL_RECONCILE_MODE=staging \
TUNNEL_CHECK_MODE=staging \
DEPLOY_LOCK_HELD=1 \
pnpm deploy:k8s:mac:staging "$ARTIFACT_FILE"

wait_release_running_pods

before_manifest="$(mktemp -t tx-agent-kit-k3s-before.XXXXXX.yaml)"
after_manifest="$(mktemp -t tx-agent-kit-k3s-after.XXXXXX.yaml)"
expected_env_file="$(mktemp -t tx-agent-kit-k3s-expected-env.XXXXXX)"
trap 'rm -f "$before_manifest" "$after_manifest" "$expected_env_file"; emit_diagnostics' ERR
helm get manifest "$RELEASE" --kube-context "$KUBE_CONTEXT" --namespace "$NAMESPACE" > "$before_manifest"

echo "Running idempotency pass (second Helm apply)"
RUN_TUNNEL_CHECK_SOFT_FAIL=0 \
REQUIRE_SMOKE=1 \
RUN_SMOKE=1 \
RUN_TUNNEL_RECONCILE=1 \
RUN_TUNNEL_CHECK=1 \
TUNNEL_RECONCILE_MODE=staging \
TUNNEL_CHECK_MODE=staging \
DEPLOY_LOCK_HELD=1 \
pnpm deploy:k8s:mac:staging "$ARTIFACT_FILE"

helm get manifest "$RELEASE" --kube-context "$KUBE_CONTEXT" --namespace "$NAMESPACE" > "$after_manifest"
if ! diff -u "$before_manifest" "$after_manifest" >/dev/null; then
  echo "Helm manifest changed across idempotency pass."
  diff -u "$before_manifest" "$after_manifest" || true
  exit 1
fi
echo "Helm idempotency check passed."

wait_release_running_pods

if ! retry_cmd 10 3 has_api_endpoints; then
  echo "Service endpoints missing for ${RELEASE}-api."
  exit 1
fi

api_pod="$(select_running_pod "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=api")"
if [[ -z "$api_pod" ]]; then
  echo "Unable to find API pod for secret/env verification."
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Missing env template: $TEMPLATE_FILE"
  exit 1
fi

op inject -f -i "$TEMPLATE_FILE" -o "$expected_env_file" >/dev/null

expected_temporal_namespace="$(extract_env_value "$expected_env_file" "TEMPORAL_NAMESPACE")"
expected_temporal_address="$(extract_env_value "$expected_env_file" "TEMPORAL_ADDRESS")"
expected_api_external_base_url="$(extract_env_value "$expected_env_file" "API_EXTERNAL_BASE_URL")"

if [[ -z "$expected_temporal_namespace" || -z "$expected_temporal_address" ]]; then
  echo "Expected Temporal config missing from rendered staging template."
  exit 1
fi

kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" exec "$api_pod" -- env \
  EXPECTED_TEMPORAL_NAMESPACE="$expected_temporal_namespace" \
  EXPECTED_TEMPORAL_ADDRESS="$expected_temporal_address" \
  sh -ceu '
  [ "${TEMPORAL_NAMESPACE:-}" = "${EXPECTED_TEMPORAL_NAMESPACE}" ]
  [ "${TEMPORAL_ADDRESS:-}" = "${EXPECTED_TEMPORAL_ADDRESS}" ]
'

worker_pod="$(select_running_pod "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=worker")"
if [[ -z "$worker_pod" ]]; then
  echo "Unable to find worker pod for secret/env verification."
  exit 1
fi

kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" exec "$worker_pod" -- env \
  EXPECTED_TEMPORAL_NAMESPACE="$expected_temporal_namespace" \
  EXPECTED_TEMPORAL_ADDRESS="$expected_temporal_address" \
  sh -ceu '
  [ "${TEMPORAL_NAMESPACE:-}" = "${EXPECTED_TEMPORAL_NAMESPACE}" ]
  [ "${TEMPORAL_ADDRESS:-}" = "${EXPECTED_TEMPORAL_ADDRESS}" ]
'

runtime_secret_name="${RELEASE}-runtime"
api_secret_ref="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment "${RELEASE}-api" -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].secretRef.name}')"
worker_secret_ref="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment "${RELEASE}-worker" -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].secretRef.name}')"
if [[ "$api_secret_ref" != "$runtime_secret_name" || "$worker_secret_ref" != "$runtime_secret_name" ]]; then
  echo "Runtime secret wiring mismatch. Expected '${runtime_secret_name}', got api='${api_secret_ref}' worker='${worker_secret_ref}'."
  exit 1
fi

deployed_api_image="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment "${RELEASE}-api" -o jsonpath='{.spec.template.spec.containers[0].image}')"
deployed_worker_image="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment "${RELEASE}-worker" -o jsonpath='{.spec.template.spec.containers[0].image}')"
if [[ "$deployed_api_image" != "$EXPECTED_API_IMAGE" || "$deployed_worker_image" != "$EXPECTED_WORKER_IMAGE" ]]; then
  echo "Deployed image mismatch. Expected api='${EXPECTED_API_IMAGE}' worker='${EXPECTED_WORKER_IMAGE}', got api='${deployed_api_image}' worker='${deployed_worker_image}'."
  exit 1
fi
echo "Artifact image verification passed."

if [[ "${VERIFY_TEMPORAL_TLS_CERT_WIRING:-0}" == "1" ]]; then
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" exec "$api_pod" -- sh -ceu '[ -n "${TEMPORAL_TLS_CA_CERT_PEM:-}" ] && [ -n "${TEMPORAL_TLS_CLIENT_CERT_PEM:-}" ] && [ -n "${TEMPORAL_TLS_CLIENT_KEY_PEM:-}" ]'
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" exec "$worker_pod" -- sh -ceu '[ -n "${TEMPORAL_TLS_CA_CERT_PEM:-}" ] && [ -n "${TEMPORAL_TLS_CLIENT_CERT_PEM:-}" ] && [ -n "${TEMPORAL_TLS_CLIENT_KEY_PEM:-}" ]'
  echo "Temporal TLS cert wiring checks passed."
fi

if kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment "${RELEASE}-otel-collector" >/dev/null 2>&1; then
  otel_pod="$(select_running_pod "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=otel-collector")"
  if [[ -z "$otel_pod" ]]; then
    echo "OTEL collector deployment exists but no pod is available for config validation."
    exit 1
  fi
  otel_configmap_ref="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment "${RELEASE}-otel-collector" -o jsonpath='{.spec.template.spec.volumes[0].configMap.name}')"
  if [[ "$otel_configmap_ref" != "${RELEASE}-otel-collector" ]]; then
    echo "OTEL collector ConfigMap wiring mismatch. Expected '${RELEASE}-otel-collector', got '${otel_configmap_ref}'."
    exit 1
  fi
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" exec "$otel_pod" -- sh -ceu 'test -s /etc/otel-collector/config.yaml && grep -q "exporters" /etc/otel-collector/config.yaml'
fi
echo "Runtime Secret/ConfigMap checks passed."

probe_pod="curl-probe-$(date +%s)-${RANDOM}-$$"
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" run "$probe_pod" \
  --image=curlimages/curl:8.12.1 \
  --restart=Never \
  --attach \
  --rm \
  --command -- sh -ceu "curl -fsS --max-time 15 http://${RELEASE}-api/health | grep -q '\"status\":\"healthy\"'"

if [[ -z "$expected_api_external_base_url" ]]; then
  echo "API_EXTERNAL_BASE_URL missing in rendered expected env from $TEMPLATE_FILE."
  exit 1
fi

if ! retry_cmd 10 3 external_health_ok "$expected_api_external_base_url"; then
  echo "External health check failed for ${expected_api_external_base_url%/}/health"
  exit 1
fi

pnpm deploy:k8s:status mac-staging

echo "Mac k3s staging verification succeeded."
