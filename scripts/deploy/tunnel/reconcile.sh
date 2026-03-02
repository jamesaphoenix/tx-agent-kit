#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-both}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../lib/lock.sh
source "$SCRIPT_DIR/../../lib/lock.sh"

if [[ "$MODE" != "dev" && "$MODE" != "staging" && "$MODE" != "prod" && "$MODE" != "both" && "$MODE" != "all" ]]; then
  echo "Usage: $0 [dev|staging|prod|both|all]"
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required"
  exit 1
fi

if [[ -z "${CLOUDFLARE_TUNNEL_ID:-}" ]]; then
  echo "CLOUDFLARE_TUNNEL_ID is required"
  exit 1
fi

if [[ -z "${CLOUDFLARE_TUNNEL_CREDENTIALS_FILE:-}" ]]; then
  echo "CLOUDFLARE_TUNNEL_CREDENTIALS_FILE is required"
  exit 1
fi

if [[ ! -f "$CLOUDFLARE_TUNNEL_CREDENTIALS_FILE" ]]; then
  echo "Tunnel credentials file not found. Set CLOUDFLARE_TUNNEL_CREDENTIALS_FILE to an existing file path."
  exit 1
fi

CONFIG_PATH="${CLOUDFLARE_TUNNEL_CONFIG_PATH:-deploy/.rendered/cloudflared/config.yaml}"
mkdir -p "$(dirname "$CONFIG_PATH")"
TMP_CONFIG_PATH="$(mktemp "${CONFIG_PATH}.XXXXXX")"
LOCK_DIR="${CLOUDFLARE_TUNNEL_LOCK_DIR:-/tmp/tx-agent-kit-cloudflared-config.lock}"
LOCK_TIMEOUT_SECONDS="${CLOUDFLARE_TUNNEL_LOCK_TIMEOUT_SECONDS:-300}"
LOCK_MISSING_PID_GRACE_SECONDS="${CLOUDFLARE_TUNNEL_LOCK_MISSING_PID_GRACE_SECONDS:-30}"
if ! lock_acquire "$LOCK_DIR" "$LOCK_TIMEOUT_SECONDS" "$LOCK_MISSING_PID_GRACE_SECONDS"; then
  echo "Another Cloudflare tunnel reconcile operation is in progress."
  exit 1
fi

cleanup() {
  rm -f "$TMP_CONFIG_PATH" >/dev/null 2>&1 || true
  lock_release "$LOCK_DIR"
}
trap cleanup EXIT

DEV_HOST="${CLOUDFLARE_TUNNEL_HOST_DEV:-}"
STAGING_HOST="${CLOUDFLARE_TUNNEL_HOST_STAGING:-}"
PROD_HOST="${CLOUDFLARE_TUNNEL_HOST_PROD:-}"
DEV_UPSTREAM="${CLOUDFLARE_TUNNEL_UPSTREAM_DEV:-http://127.0.0.1:4000}"
STAGING_UPSTREAM="${CLOUDFLARE_TUNNEL_UPSTREAM_STAGING:-http://127.0.0.1:32080}"
PROD_UPSTREAM="${CLOUDFLARE_TUNNEL_UPSTREAM_PROD:-http://127.0.0.1:32081}"

declare -a SELECTED_ENVS
case "$MODE" in
  dev)
    SELECTED_ENVS=("dev")
    ;;
  staging)
    SELECTED_ENVS=("staging")
    ;;
  prod)
    SELECTED_ENVS=("prod")
    ;;
  both)
    SELECTED_ENVS=("staging" "prod")
    ;;
  all)
    SELECTED_ENVS=("dev" "staging" "prod")
    ;;
esac

host_for_env() {
  local env_name="$1"
  case "$env_name" in
    dev)
      printf '%s\n' "$DEV_HOST"
      ;;
    staging)
      printf '%s\n' "$STAGING_HOST"
      ;;
    prod)
      printf '%s\n' "$PROD_HOST"
      ;;
  esac
}

upstream_for_env() {
  local env_name="$1"
  case "$env_name" in
    dev)
      printf '%s\n' "$DEV_UPSTREAM"
      ;;
    staging)
      printf '%s\n' "$STAGING_UPSTREAM"
      ;;
    prod)
      printf '%s\n' "$PROD_UPSTREAM"
      ;;
  esac
}

required_host_var_for_env() {
  local env_name="$1"
  case "$env_name" in
    dev)
      printf '%s\n' "CLOUDFLARE_TUNNEL_HOST_DEV"
      ;;
    staging)
      printf '%s\n' "CLOUDFLARE_TUNNEL_HOST_STAGING"
      ;;
    prod)
      printf '%s\n' "CLOUDFLARE_TUNNEL_HOST_PROD"
      ;;
  esac
}

for env_name in "${SELECTED_ENVS[@]}"; do
  host="$(host_for_env "$env_name")"
  if [[ -z "$host" ]]; then
    required_var="$(required_host_var_for_env "$env_name")"
    echo "${required_var} is required for mode '$MODE'"
    exit 1
  fi
done

declare -a ingress_pairs=()

upsert_pair() {
  local host="$1"
  local service="$2"
  local index

  for index in "${!ingress_pairs[@]}"; do
    existing_host="${ingress_pairs[$index]%%|*}"
    if [[ "$existing_host" == "$host" ]]; then
      ingress_pairs[$index]="${host}|${service}"
      return
    fi
  done

  ingress_pairs+=("${host}|${service}")
}

if [[ -f "$CONFIG_PATH" ]]; then
  current_host=""
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line#${raw_line%%[![:space:]]*}}"
    line="${line%${line##*[![:space:]]}}"

    if [[ "$line" == "- hostname:"* || "$line" == "hostname:"* ]]; then
      current_host="${line#*- hostname: }"
      current_host="${current_host#hostname: }"
      current_host="${current_host%\"}"
      current_host="${current_host#\"}"
      continue
    fi

    if [[ "$line" == "service:"* || "$line" == *" service:"* ]]; then
      if [[ -z "$current_host" ]]; then
        continue
      fi

      service="${line##*service: }"
      if [[ "$service" == "http_status:404" ]]; then
        continue
      fi

      upsert_pair "$current_host" "$service"
      current_host=""
    fi
  done < "$CONFIG_PATH"
fi

for env_name in "${SELECTED_ENVS[@]}"; do
  host="$(host_for_env "$env_name")"
  if [[ -n "$host" ]]; then
    upstream="$(upstream_for_env "$env_name")"
    upsert_pair "$host" "$upstream"
  fi
done

if [[ "${#ingress_pairs[@]}" -eq 0 ]]; then
  echo "No tunnel hostnames configured or discovered in existing config."
  exit 1
fi

{
  echo "tunnel: $CLOUDFLARE_TUNNEL_ID"
  echo "credentials-file: $CLOUDFLARE_TUNNEL_CREDENTIALS_FILE"
  echo "ingress:"

  for pair in "${ingress_pairs[@]}"; do
    host="${pair%%|*}"
    upstream="${pair#*|}"
    echo "  - hostname: $host"
    echo "    service: $upstream"
  done

  echo "  - service: http_status:404"
} > "$TMP_CONFIG_PATH"

cloudflared tunnel --config "$TMP_CONFIG_PATH" ingress validate
mv "$TMP_CONFIG_PATH" "$CONFIG_PATH"

if [[ "${CLOUDFLARE_TUNNEL_MANAGE_DNS:-0}" == "1" ]]; then
  for env_name in "${SELECTED_ENVS[@]}"; do
    host="$(host_for_env "$env_name")"
    cloudflared tunnel --config "$CONFIG_PATH" route dns "$CLOUDFLARE_TUNNEL_ID" "$host"
  done
fi

if [[ -n "${CLOUDFLARED_RESTART_COMMAND:-}" ]]; then
  read -r -a restart_command_parts <<< "$CLOUDFLARED_RESTART_COMMAND"
  if [[ "${#restart_command_parts[@]}" -eq 0 ]]; then
    echo "CLOUDFLARED_RESTART_COMMAND is set but empty."
    exit 1
  fi
  "${restart_command_parts[@]}"
fi

echo "Cloudflare tunnel config reconciled at $CONFIG_PATH"
