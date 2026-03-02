#!/usr/bin/env bash

set -euo pipefail

target_context="${K8S_CONTEXT_MAC:-${K8S_CONTEXT:-k3s}}"
cluster_name="${K3D_CLUSTER_NAME:-tx-agent-kit-staging}"
allow_k3d_fallback="${K3S_BOOTSTRAP_ALLOW_K3D:-0}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd"
    exit 1
  fi
}

require_cmd kubectl

context_exists() {
  kubectl config get-contexts "$1" >/dev/null 2>&1
}

context_reachable() {
  kubectl --context "$1" get nodes >/dev/null 2>&1
}

if context_exists "$target_context" && context_reachable "$target_context"; then
  kubectl --context "$target_context" wait node --all --for=condition=Ready --timeout="${K3S_NODE_READY_TIMEOUT:-180s}" >/dev/null
  echo "K8S_BOOTSTRAP_CONTEXT=$target_context"
  exit 0
fi

if context_exists "$target_context" && ! context_reachable "$target_context"; then
  echo "Configured Kubernetes context '$target_context' exists but is unreachable."
  echo "Fix cluster connectivity instead of falling back to another cluster."
  exit 1
fi

if [[ "$allow_k3d_fallback" == "1" ]] && command -v k3d >/dev/null 2>&1; then
  if ! k3d cluster list 2>/dev/null | awk 'NR>1 { print $1 }' | grep -Fxq "$cluster_name"; then
    echo "Creating k3d cluster '$cluster_name' for staging verification."
    k3d cluster create "$cluster_name" --wait
  fi

  k3d_context="k3d-${cluster_name}"
  kubectl config use-context "$k3d_context" >/dev/null
  kubectl --context "$k3d_context" wait node --all --for=condition=Ready --timeout="${K3S_NODE_READY_TIMEOUT:-180s}" >/dev/null
  echo "K8S_BOOTSTRAP_CONTEXT=$k3d_context"
  exit 0
fi

echo "Unable to bootstrap local k3s context '$target_context'."
echo "Install/configure k3s for this context. For local fallback only, set K3S_BOOTSTRAP_ALLOW_K3D=1."
exit 1
