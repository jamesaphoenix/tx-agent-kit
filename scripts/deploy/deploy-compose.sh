#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <staging|prod> [images-env-file]"
  exit 1
fi

TARGET_ENV="$1"
IMAGES_ENV_FILE="${2:-}"

if [[ "$TARGET_ENV" != "staging" && "$TARGET_ENV" != "prod" ]]; then
  echo "Invalid environment '$TARGET_ENV'. Expected 'staging' or 'prod'."
  exit 1
fi

if ! command -v op >/dev/null 2>&1; then
  echo "1Password CLI (op) is required"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

if [[ -n "$IMAGES_ENV_FILE" ]]; then
  if [[ ! -f "$IMAGES_ENV_FILE" ]]; then
    echo "Image env file not found: $IMAGES_ENV_FILE"
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$IMAGES_ENV_FILE"
  set +a
fi

if [[ -z "${API_IMAGE:-}" || -z "${WORKER_IMAGE:-}" ]]; then
  echo "API_IMAGE and WORKER_IMAGE must be provided (either environment or images env file)."
  exit 1
fi

TEMPLATE_FILE="deploy/env/${TARGET_ENV}.env.template"
COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-docker-compose.${TARGET_ENV}.yml}"

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Missing env template: $TEMPLATE_FILE"
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $COMPOSE_FILE"
  exit 1
fi

RENDERED_ENV_DIR="${DEPLOY_RENDERED_DIR:-deploy/.rendered}"
mkdir -p "$RENDERED_ENV_DIR"
RENDERED_ENV_FILE="${RENDERED_ENV_DIR}/${TARGET_ENV}.env"

op inject -i "$TEMPLATE_FILE" -o "$RENDERED_ENV_FILE" >/dev/null

{
  printf '\nAPI_IMAGE=%s\n' "$API_IMAGE"
  printf 'WORKER_IMAGE=%s\n' "$WORKER_IMAGE"
} >> "$RENDERED_ENV_FILE"

export DEPLOY_ENV_FILE="$RENDERED_ENV_FILE"

echo "Deploying $TARGET_ENV with compose file $COMPOSE_FILE"
docker compose -f "$COMPOSE_FILE" --env-file "$RENDERED_ENV_FILE" pull
docker compose -f "$COMPOSE_FILE" --env-file "$RENDERED_ENV_FILE" up -d --remove-orphans

if [[ "${RUN_SMOKE:-1}" == "1" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$RENDERED_ENV_FILE"
  set +a

  if [[ -z "${API_EXTERNAL_BASE_URL:-}" ]]; then
    echo "Skipping smoke checks: API_EXTERNAL_BASE_URL is not configured"
    exit 0
  fi

  echo "Running smoke checks against ${API_EXTERNAL_BASE_URL}"
  API_BASE_URL="$API_EXTERNAL_BASE_URL" "$SCRIPT_DIR/smoke-api.sh"
fi
