#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <mac-staging|mac-prod|gke-staging|gke-prod>"
  exit 1
fi

environment="$1"

case "$environment" in
  mac-staging)
    kustomization_name="tx-agent-kit-mac-staging"
    kube_context="${K8S_CONTEXT_MAC:-${K8S_CONTEXT:-k3s}}"
    ;;
  mac-prod)
    kustomization_name="tx-agent-kit-mac-prod"
    kube_context="${K8S_CONTEXT_MAC:-${K8S_CONTEXT:-k3s}}"
    ;;
  gke-staging)
    kustomization_name="tx-agent-kit-gke-staging"
    kube_context="${K8S_CONTEXT_GKE:-}"
    ;;
  gke-prod)
    kustomization_name="tx-agent-kit-gke-prod"
    kube_context="${K8S_CONTEXT_GKE:-}"
    ;;
  *)
    echo "Invalid environment '$environment'."
    exit 1
    ;;
esac

if ! command -v flux >/dev/null 2>&1; then
  if [[ "${ALLOW_RECONCILE_SKIP:-0}" == "1" && "${CI:-false}" != "true" ]]; then
    echo "Flux CLI not found. Skipping forced reconcile because ALLOW_RECONCILE_SKIP=1."
    exit 0
  fi
  echo "Flux CLI not found. Install flux or set ALLOW_RECONCILE_SKIP=1 for local-only workflows."
  exit 1
fi

if [[ -z "$kube_context" ]]; then
  echo "Kubernetes context is required for '$environment'."
  exit 1
fi

flux --context "$kube_context" reconcile source git tx-agent-kit-repo -n flux-system --with-source
flux --context "$kube_context" reconcile kustomization "$kustomization_name" -n flux-system --with-source

echo "Flux reconcile completed for $environment"
