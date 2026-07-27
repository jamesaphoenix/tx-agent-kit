#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Bounded, HOME-isolated `op` (see scripts/lib/op-cli.sh for the traced root cause).
# shellcheck source=scripts/lib/op-cli.sh
source "$SCRIPT_DIR/../lib/op-cli.sh"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Fail fast on missing secret fields BEFORE the slow `op inject`. When a field is
# absent from the 1Password env item, `op inject` can burn its full timeout and
# only ever reports the FIRST unresolved reference, wasting a deploy cycle with an
# opaque exit 143. This pre-flight diffs every `op://${OP_VAULT}/${OP_ENV}/<FIELD>`
# reference in the template against the fields actually present on that item and
# halts immediately, listing ALL missing fields. Skips cleanly (defers to op
# inject) when jq, the template vars, or the item read are unavailable, so it
# never becomes a new failure point.
#
# OP_VAULT/OP_ENV here are NOT exported shell variables — they are defined inside
# the template (op inject template vars), so we parse them from the template file
# rather than reading the environment.
preflight_missing_op_fields() {
  local template_file="$1"
  command -v jq >/dev/null 2>&1 || { echo "Pre-flight: jq unavailable; deferring field validation to op inject."; return 0; }

  local op_vault op_env
  op_vault="$(grep -E '^OP_VAULT=' "$template_file" | head -n1 | cut -d= -f2-)"
  op_env="$(grep -E '^OP_ENV=' "$template_file" | head -n1 | cut -d= -f2-)"
  # Skip cleanly when the template still ships placeholders (e.g. <vault>/<environment>) or omits them.
  case "$op_vault" in ''|'<'*) echo "Pre-flight: OP_VAULT not resolved in $template_file; skipping op preflight (template uses placeholders), deferring to op inject."; return 0 ;; esac
  case "$op_env" in ''|'<'*) echo "Pre-flight: OP_ENV not resolved in $template_file; skipping op preflight (template uses placeholders), deferring to op inject."; return 0 ;; esac

  local expected_fields
  expected_fields="$(grep -oE 'op://\$\{OP_VAULT\}/\$\{OP_ENV\}/[A-Za-z0-9_]+' "$template_file" | sed -E 's#.*/##' | sort -u)"
  [[ -z "$expected_fields" ]] && return 0

  local item_json
  if ! item_json="$(run_op item get "$op_env" --vault "$op_vault" --format json 2>/dev/null)"; then
    echo "Pre-flight: could not read op://$op_vault/$op_env; deferring field validation to op inject."
    return 0
  fi

  local present_fields missing
  present_fields="$(printf '%s' "$item_json" | jq -r '.fields[].label' | sort -u)"
  missing="$(comm -23 <(printf '%s\n' "$expected_fields") <(printf '%s\n' "$present_fields"))"

  if [[ -n "$missing" ]]; then
    echo "Deploy halted: 1Password item op://$op_vault/$op_env is missing field(s) referenced by $template_file:"
    printf '%s\n' "$missing" | sed 's/^/  - /'
    echo "Add the field(s) to the item, then re-run the deploy."
    exit 1
  fi
}

# Assert each force-recreated app container is actually running the released
# image — not a cached/shadowed older one. `docker compose up --force-recreate`
# can report success while Docker keeps serving a stale local image (image-cache
# reuse, or a Colima/Docker-Desktop engine shadow), so the deploy "succeeds" but
# old code keeps running. Comparing the RUNNING container's image ID against the
# EXPECTED image's ID catches this even when the tag ref is unchanged: a repointed
# tag matches by ref but differs by digest. A mismatch fails the deploy; this
# script has NO ERR-trap rollback, so `set -e` simply aborts (no auto-rollback).
# Gated by VERIFY_RUNNING_IMAGES (default 1). This repo's compose has only the
# app services api + worker (no mcp).
verify_running_images() {
  if [[ "${VERIFY_RUNNING_IMAGES:-1}" != "1" ]]; then
    echo "Skipping running-image verification because VERIFY_RUNNING_IMAGES=${VERIFY_RUNNING_IMAGES}."
    return 0
  fi

  local mismatch=0
  local entry service expected_ref expected_id container_id running_id
  for entry in "api=${API_IMAGE}" "worker=${WORKER_IMAGE}"; do
    service="${entry%%=*}"
    expected_ref="${entry#*=}"

    expected_id="$(docker inspect "$expected_ref" --format '{{.Id}}' 2>/dev/null || true)"
    if [[ -z "$expected_id" ]]; then
      echo "verify_running_images: expected image '$expected_ref' for '$service' is not present locally; cannot verify."
      mismatch=1
      continue
    fi

    container_id="$(docker compose -f "$COMPOSE_FILE" --env-file "$RENDERED_ENV_FILE" ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$container_id" ]]; then
      echo "verify_running_images: no running container for service '$service'."
      mismatch=1
      continue
    fi

    running_id="$(docker inspect "$container_id" --format '{{.Image}}' 2>/dev/null || true)"
    if [[ "$running_id" != "$expected_id" ]]; then
      echo "verify_running_images: '$service' is running image ${running_id:-<none>} but the release expects $expected_id ($expected_ref); the deploy served a stale/cached image."
      mismatch=1
      continue
    fi

    echo "verify_running_images: '$service' confirmed on the released image ($expected_ref)."
  done

  if [[ "$mismatch" != "0" ]]; then
    echo "Running-image verification FAILED; failing the deploy (set -e aborts; there is no auto-rollback in this script)."
    return 1
  fi

  echo "Running-image verification passed: api and worker are on the released images."
  return 0
}

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

preflight_missing_op_fields "$TEMPLATE_FILE"
run_op inject -f -i "$TEMPLATE_FILE" -o "$RENDERED_ENV_FILE" >/dev/null

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

# Force-recreate the app services so rendered env_file changes ALWAYS take effect,
# even when the image digest is unchanged (a same-commit redeploy). Compose only
# recreates a container on image/`environment:` changes, NOT on env_file CONTENT
# changes, so without this a secret newly added to the rendered env between deploys
# silently never reaches the running container. Scoped to the app services
# (--no-deps) so stateful/infra services aren't churned; volumes persist across
# --force-recreate (data-safe). This repo's compose has only api + worker (no mcp).
docker compose -f "$COMPOSE_FILE" --env-file "$RENDERED_ENV_FILE" up -d --no-deps --force-recreate api worker

# Catch "deploy succeeded but a stale/cached image is still serving" BEFORE the
# tunnel/smoke checks. On mismatch this returns non-zero and `set -e` aborts the
# deploy (this script has no ERR-trap auto-rollback).
verify_running_images

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
