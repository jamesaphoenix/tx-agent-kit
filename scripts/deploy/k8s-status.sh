#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <mac-staging|mac-prod|gke>"
  exit 1
fi

TARGET="$1"

case "$TARGET" in
  mac-staging)
    KUBE_CONTEXT="${K8S_CONTEXT_MAC:-${K8S_CONTEXT:-k3s}}"
    NAMESPACE="${K8S_NAMESPACE_MAC_STAGING:-tx-staging}"
    RELEASE="${HELM_RELEASE_MAC_STAGING:-tx-agent-kit-staging}"
    ;;
  mac-prod)
    KUBE_CONTEXT="${K8S_CONTEXT_MAC:-${K8S_CONTEXT:-k3s}}"
    NAMESPACE="${K8S_NAMESPACE_MAC_PROD:-tx-prod}"
    RELEASE="${HELM_RELEASE_MAC_PROD:-tx-agent-kit-prod}"
    ;;
  gke)
    if [[ -z "${K8S_CONTEXT_GKE:-}" ]]; then
      echo "K8S_CONTEXT_GKE must be set for gke status"
      exit 1
    fi

    KUBE_CONTEXT="$K8S_CONTEXT_GKE"
    if [[ "${GKE_ENVIRONMENT:-staging}" == "prod" ]]; then
      NAMESPACE="${K8S_NAMESPACE_GKE_PROD:-${K8S_NAMESPACE_GKE:-tx-agent-kit-gke-prod}}"
      RELEASE="${HELM_RELEASE_GKE_PROD:-${HELM_RELEASE_GKE:-tx-agent-kit-gke-prod}}"
    else
      NAMESPACE="${K8S_NAMESPACE_GKE_STAGING:-${K8S_NAMESPACE_GKE:-tx-agent-kit-gke-staging}}"
      RELEASE="${HELM_RELEASE_GKE_STAGING:-${HELM_RELEASE_GKE:-tx-agent-kit-gke-staging}}"
    fi
    ;;
  *)
    echo "Invalid target '$TARGET'."
    exit 1
    ;;
esac

helm status "$RELEASE" --kube-context "$KUBE_CONTEXT" --namespace "$NAMESPACE"
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deployment,pod,svc,ingress
