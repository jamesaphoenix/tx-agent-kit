#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../lib/lock.sh
source "$SCRIPT_DIR/../lib/lock.sh"

cd "$PROJECT_ROOT"

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 <mac|gke> <staging|prod> [images-env-file]"
  exit 1
fi

TARGET="$1"
DEPLOY_ENV="$2"
IMAGES_ENV_FILE="${3:-}"

if [[ "$TARGET" != "mac" && "$TARGET" != "gke" ]]; then
  echo "Invalid target '$TARGET'. Expected 'mac' or 'gke'."
  exit 1
fi

if [[ "$DEPLOY_ENV" != "staging" && "$DEPLOY_ENV" != "prod" ]]; then
  echo "Invalid environment '$DEPLOY_ENV'. Expected 'staging' or 'prod'."
  exit 1
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd"
    exit 1
  fi
}

require_cmd op
require_cmd helm
require_cmd kubectl
require_cmd node

LOCK_DIR="${DEPLOY_LOCK_DIR:-/tmp/tx-agent-kit-deploy-${TARGET}-${DEPLOY_ENV}.lock}"
LOCK_TIMEOUT_SECONDS="${DEPLOY_LOCK_TIMEOUT_SECONDS:-900}"
LOCK_MISSING_PID_GRACE_SECONDS="${DEPLOY_LOCK_MISSING_PID_GRACE_SECONDS:-30}"
LOCK_ACQUIRED=0
if [[ "${DEPLOY_LOCK_HELD:-0}" != "1" ]]; then
  if ! lock_acquire "$LOCK_DIR" "$LOCK_TIMEOUT_SECONDS" "$LOCK_MISSING_PID_GRACE_SECONDS"; then
    echo "Another deploy is already in progress for ${TARGET}/${DEPLOY_ENV}."
    exit 1
  fi
  LOCK_ACQUIRED=1
fi

RUNTIME_VALUES_FILE=""
RENDERED_ENV_FILE=""
KUBE_CONTEXT=""
NAMESPACE=""
RELEASE=""

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

emit_k8s_diagnostics() {
  if [[ -z "$KUBE_CONTEXT" || -z "$NAMESPACE" ]]; then
    return
  fi

  echo "----- Kubernetes diagnostics (${KUBE_CONTEXT}/${NAMESPACE}) -----"
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment,pod,svc,ingress || true
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 80 || true
  if [[ -n "$RELEASE" ]]; then
    kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" describe deployment "${RELEASE}-api" || true
    kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" describe deployment "${RELEASE}-worker" || true
    kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" logs "deployment/${RELEASE}-api" --tail=100 || true
    kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" logs "deployment/${RELEASE}-worker" --tail=100 || true
  fi
  echo "----- End diagnostics -----"
}

cleanup() {
  rm -f "${RUNTIME_VALUES_FILE:-}"
  rm -f "${RENDERED_ENV_FILE:-}"
  if [[ "$LOCK_ACQUIRED" == "1" ]]; then
    lock_release "$LOCK_DIR"
  fi
}

on_error() {
  local line="$1"
  echo "Deploy failed at line ${line}."
  emit_k8s_diagnostics
}

trap cleanup EXIT
trap 'on_error "$LINENO"' ERR

if [[ -n "$IMAGES_ENV_FILE" ]]; then
  if [[ ! -f "$IMAGES_ENV_FILE" ]]; then
    echo "Image env file not found: $IMAGES_ENV_FILE"
    exit 1
  fi

  while IFS='=' read -r key value; do
    case "$key" in
      API_IMAGE)
        API_IMAGE="$value"
        ;;
      WORKER_IMAGE)
        WORKER_IMAGE="$value"
        ;;
    esac
  done < <("$SCRIPT_DIR/ci/load-image-artifact.sh" "$IMAGES_ENV_FILE")
fi

if [[ -z "${API_IMAGE:-}" || -z "${WORKER_IMAGE:-}" ]]; then
  echo "API_IMAGE and WORKER_IMAGE must be provided (either env or images env file)."
  exit 1
fi

TEMPLATE_FILE="deploy/env/${DEPLOY_ENV}.env.template"
if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Missing env template: $TEMPLATE_FILE"
  exit 1
fi

if [[ "$TARGET" == "mac" ]]; then
  KUBE_CONTEXT="${K8S_CONTEXT_MAC:-${K8S_CONTEXT:-k3s}}"

  if [[ "$DEPLOY_ENV" == "staging" ]]; then
    NAMESPACE="${K8S_NAMESPACE_MAC_STAGING:-tx-staging}"
    RELEASE="${HELM_RELEASE_MAC_STAGING:-tx-agent-kit-staging}"
    VALUES_FILE="deploy/k8s/chart/values.mac-staging.yaml"
  else
    NAMESPACE="${K8S_NAMESPACE_MAC_PROD:-tx-prod}"
    RELEASE="${HELM_RELEASE_MAC_PROD:-tx-agent-kit-prod}"
    VALUES_FILE="deploy/k8s/chart/values.mac-prod.yaml"
  fi
else
  if [[ -z "${K8S_CONTEXT_GKE:-}" ]]; then
    echo "K8S_CONTEXT_GKE must be set for gke deployments"
    exit 1
  fi

  KUBE_CONTEXT="$K8S_CONTEXT_GKE"
  if [[ "$DEPLOY_ENV" == "staging" ]]; then
    NAMESPACE="${K8S_NAMESPACE_GKE_STAGING:-${K8S_NAMESPACE_GKE:-tx-gke-staging}}"
    RELEASE="${HELM_RELEASE_GKE_STAGING:-${HELM_RELEASE_GKE:-tx-agent-kit-gke-staging}}"
  else
    NAMESPACE="${K8S_NAMESPACE_GKE_PROD:-${K8S_NAMESPACE_GKE:-tx-gke-prod}}"
    RELEASE="${HELM_RELEASE_GKE_PROD:-${HELM_RELEASE_GKE:-tx-agent-kit-gke-prod}}"
  fi
  VALUES_FILE="deploy/k8s/chart/values.gke.${DEPLOY_ENV}.yaml"
fi

if [[ ! -f "$VALUES_FILE" ]]; then
  echo "Missing values file: $VALUES_FILE"
  exit 1
fi

rendered_env_base_dir="${DEPLOY_RENDERED_ENV_DIR:-${RUNNER_TEMP:-/tmp}}"
mkdir -p "$rendered_env_base_dir"
RENDERED_ENV_FILE="$(mktemp "$rendered_env_base_dir/tx-agent-kit-k8s-${TARGET}-${DEPLOY_ENV}.env.XXXXXX")"
chmod 600 "$RENDERED_ENV_FILE"
op inject -f -i "$TEMPLATE_FILE" -o "$RENDERED_ENV_FILE" >/dev/null
if [[ -n "${RUNTIME_ENV_OVERRIDES_FILE:-}" ]]; then
  if [[ ! -f "$RUNTIME_ENV_OVERRIDES_FILE" ]]; then
    echo "Runtime overrides file not found: $RUNTIME_ENV_OVERRIDES_FILE"
    exit 1
  fi
  cat "$RUNTIME_ENV_OVERRIDES_FILE" >> "$RENDERED_ENV_FILE"
fi

OTEL_ENDPOINT="http://${RELEASE}-otel-collector:4318"
RUNTIME_VALUES_FILE="$(mktemp -t tx-agent-kit-k8s-values.XXXXXX.yaml)"

node "$SCRIPT_DIR/render-runtime-values.mjs" \
  --env-file "$RENDERED_ENV_FILE" \
  --api-image "$API_IMAGE" \
  --worker-image "$WORKER_IMAGE" \
  --otel-endpoint "$OTEL_ENDPOINT" \
  --output "$RUNTIME_VALUES_FILE"

helm_args=(
  upgrade
  --install
  "$RELEASE"
  deploy/k8s/chart
  --kube-context "$KUBE_CONTEXT"
  --namespace "$NAMESPACE"
  --create-namespace
  --wait
  --timeout "${K8S_HELM_TIMEOUT:-10m}"
  --set-string "fullnameOverride=$RELEASE"
  -f "$VALUES_FILE"
  -f "$RUNTIME_VALUES_FILE"
)

if [[ "${K8S_HELM_ATOMIC:-1}" == "1" ]]; then
  helm_args+=(--atomic)
fi

helm "${helm_args[@]}"

kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" rollout status "deployment/${RELEASE}-api" --timeout="${K8S_ROLLOUT_TIMEOUT:-300s}"
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" rollout status "deployment/${RELEASE}-worker" --timeout="${K8S_ROLLOUT_TIMEOUT:-300s}"
if kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment "${RELEASE}-otel-collector" >/dev/null 2>&1; then
  kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" rollout status "deployment/${RELEASE}-otel-collector" --timeout="${K8S_ROLLOUT_TIMEOUT:-300s}"
fi
wait_release_running_pods

if [[ "$TARGET" == "mac" && "${RUN_TUNNEL_RECONCILE:-1}" == "1" ]]; then
  reconcile_mode="${TUNNEL_RECONCILE_MODE:-both}"
  check_mode="${TUNNEL_CHECK_MODE:-$DEPLOY_ENV}"
  "$SCRIPT_DIR/tunnel/reconcile.sh" "$reconcile_mode"
  if [[ "${RUN_TUNNEL_CHECK:-1}" == "1" ]]; then
    if ! "$SCRIPT_DIR/tunnel/check.sh" "$check_mode"; then
      if [[ "${RUN_TUNNEL_CHECK_SOFT_FAIL:-0}" == "1" ]]; then
        echo "Cloudflare tunnel health check failed; continuing because RUN_TUNNEL_CHECK_SOFT_FAIL=1"
      else
        echo "Cloudflare tunnel health check failed"
        exit 1
      fi
    fi
  fi
fi

if [[ "${RUN_SMOKE:-1}" == "1" ]]; then
  api_external_base_url="$(
    awk -F= '/^API_EXTERNAL_BASE_URL=/{sub(/^[^=]*=/, ""); print; exit}' "$RENDERED_ENV_FILE"
  )"
  api_external_base_url="${api_external_base_url%\"}"
  api_external_base_url="${api_external_base_url#\"}"
  api_external_base_url="${api_external_base_url%\'}"
  api_external_base_url="${api_external_base_url#\'}"

  if [[ -z "$api_external_base_url" ]]; then
    if [[ "${REQUIRE_SMOKE:-0}" == "1" ]]; then
      echo "Smoke checks are required but API_EXTERNAL_BASE_URL is not configured."
      exit 1
    fi
    echo "Skipping smoke checks: API_EXTERNAL_BASE_URL is not configured"
    exit 0
  fi

  echo "Running smoke checks against ${api_external_base_url}"
  API_BASE_URL="$api_external_base_url" "$SCRIPT_DIR/smoke-api.sh"
fi
