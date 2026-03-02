#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ENV="${GKE_ENVIRONMENT:-staging}"
IMAGES_ENV_FILE="${1:-}"

if [[ -n "$IMAGES_ENV_FILE" ]]; then
  exec "$SCRIPT_DIR/deploy-k8s.sh" gke "$DEPLOY_ENV" "$IMAGES_ENV_FILE"
fi

exec "$SCRIPT_DIR/deploy-k8s.sh" gke "$DEPLOY_ENV"
