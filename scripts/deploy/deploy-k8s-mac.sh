#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <staging|prod> [images-env-file]"
  exit 1
fi

DEPLOY_ENV="$1"
IMAGES_ENV_FILE="${2:-}"

if [[ -n "$IMAGES_ENV_FILE" ]]; then
  exec "$SCRIPT_DIR/deploy-k8s.sh" mac "$DEPLOY_ENV" "$IMAGES_ENV_FILE"
fi

exec "$SCRIPT_DIR/deploy-k8s.sh" mac "$DEPLOY_ENV"
