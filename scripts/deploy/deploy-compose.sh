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

  while IFS='=' read -r key value; do
    case "$key" in
      API_IMAGE) export API_IMAGE="$value" ;;
      WORKER_IMAGE) export WORKER_IMAGE="$value" ;;
    esac
  done < <("$SCRIPT_DIR/ci/load-image-artifact.sh" "$IMAGES_ENV_FILE")
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

RENDERED_ENV_FILE="$(mktemp /tmp/tx-deploy-compose-XXXXXX.env)"
chmod 600 "$RENDERED_ENV_FILE"
cleanup_rendered_env() { rm -f "$RENDERED_ENV_FILE"; }
trap cleanup_rendered_env EXIT

op inject -f -i "$TEMPLATE_FILE" -o "$RENDERED_ENV_FILE" >/dev/null

{
  printf '\nAPI_IMAGE=%s\n' "$API_IMAGE"
  printf 'WORKER_IMAGE=%s\n' "$WORKER_IMAGE"
} >> "$RENDERED_ENV_FILE"

export DEPLOY_ENV_FILE="$RENDERED_ENV_FILE"

echo "Deploying $TARGET_ENV with compose file $COMPOSE_FILE"
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  docker compose -f "$COMPOSE_FILE" --env-file "$RENDERED_ENV_FILE" pull
fi
docker compose -f "$COMPOSE_FILE" --env-file "$RENDERED_ENV_FILE" up -d --remove-orphans

# ── Cloudflare tunnel reconcile + check ──────────────────────
# Opt-in for compose deploys (default off). K8s path defaults to on.
# Set RUN_TUNNEL_RECONCILE=1 to enable. Requires cloudflared, CLOUDFLARE_TUNNEL_ID,
# and CLOUDFLARE_TUNNEL_CREDENTIALS_FILE.
if [[ "${RUN_TUNNEL_RECONCILE:-0}" == "1" ]]; then
  reconcile_mode="${TUNNEL_RECONCILE_MODE:-$TARGET_ENV}"
  check_mode="${TUNNEL_CHECK_MODE:-$TARGET_ENV}"
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
  # Smoke against the LOCAL API port, NOT the external Cloudflare URL. The smoke
  # check does real sign-ups, which are rate-limited in TWO places: a Cloudflare
  # rule on the sign-up path (avoided by hitting :API_PORT directly) AND the API's
  # own auth rate-limit middleware (which the local port can't dodge). For the
  # latter, the smoke test forwards the AUTH_RATE_LIMIT_BYPASS_TOKEN header so
  # several deploys per hour from one egress IP don't 429 (a self-inflicted block
  # on active deploy days). The external tunnel path is validated separately by the
  # tunnel-health check above; this validates app behaviour. Override with
  # SMOKE_API_BASE_URL to force a specific target.
  SMOKE_API_PORT=""
  SMOKE_RATE_LIMIT_BYPASS_TOKEN=""
  while IFS='=' read -r key value; do
    if [[ "$key" == "API_PORT" ]]; then
      SMOKE_API_PORT="$value"
    elif [[ "$key" == "AUTH_RATE_LIMIT_BYPASS_TOKEN" ]]; then
      SMOKE_RATE_LIMIT_BYPASS_TOKEN="$value"
    fi
  done < "$RENDERED_ENV_FILE"

  SMOKE_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:${SMOKE_API_PORT}}"

  if [[ -z "$SMOKE_API_PORT" && -z "${SMOKE_API_BASE_URL:-}" ]]; then
    echo "Skipping smoke checks: API_PORT is not configured"
    exit 0
  fi

  echo "Running smoke checks against ${SMOKE_BASE_URL} (local; CF tunnel verified separately)"
  API_BASE_URL="$SMOKE_BASE_URL" AUTH_RATE_LIMIT_BYPASS_TOKEN="$SMOKE_RATE_LIMIT_BYPASS_TOKEN" "$SCRIPT_DIR/smoke-api.sh"
fi
