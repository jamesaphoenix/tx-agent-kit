#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-both}"

if [[ "$MODE" != "dev" && "$MODE" != "staging" && "$MODE" != "prod" && "$MODE" != "both" && "$MODE" != "all" ]]; then
  echo "Usage: $0 [dev|staging|prod|both|all]"
  exit 1
fi

require_host() {
  local mode="$1"
  local host="$2"

  if [[ -z "$host" ]]; then
    echo "Missing tunnel host for $mode"
    exit 1
  fi
}

check_host() {
  local host="$1"
  local attempts="${CLOUDFLARE_TUNNEL_CHECK_ATTEMPTS:-10}"
  local sleep_seconds="${CLOUDFLARE_TUNNEL_CHECK_SLEEP_SECONDS:-3}"

  local index
  for (( index=1; index<=attempts; index+=1 )); do
    local response
    response="$(curl -fsS --max-time 10 "https://${host}/health" 2>/dev/null || true)"
    if [[ "$response" =~ \"status\"[[:space:]]*:[[:space:]]*\"healthy\" ]]; then
      echo "Tunnel health passed for ${host}"
      return 0
    fi

    sleep "$sleep_seconds"
  done

  echo "Tunnel health check failed for ${host}"
  return 1
}

DEV_HOST="${CLOUDFLARE_TUNNEL_HOST_DEV:-}"
STAGING_HOST="${CLOUDFLARE_TUNNEL_HOST_STAGING:-}"
PROD_HOST="${CLOUDFLARE_TUNNEL_HOST_PROD:-}"
DEV_UPSTREAM="${CLOUDFLARE_TUNNEL_UPSTREAM_DEV:-http://127.0.0.1:4000}"
STAGING_UPSTREAM="${CLOUDFLARE_TUNNEL_UPSTREAM_STAGING:-http://127.0.0.1:32080}"
PROD_UPSTREAM="${CLOUDFLARE_TUNNEL_UPSTREAM_PROD:-http://127.0.0.1:32081}"
CONFIG_PATH="${CLOUDFLARE_TUNNEL_CONFIG_PATH:-deploy/.rendered/cloudflared/config.yaml}"

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

resolve_config_upstream_for_host() {
  local host="$1"
  local config_file="$2"

  awk -v expected_host="$host" '
    {
      line=$0
      gsub(/^[ \t]+/, "", line)
      if (line ~ /^- hostname:[[:space:]]*/) {
        current_host=line
        sub(/^- hostname:[[:space:]]*/, "", current_host)
        next
      }
      if (line ~ /^hostname:[[:space:]]*/) {
        current_host=line
        sub(/^hostname:[[:space:]]*/, "", current_host)
        next
      }
      if (line ~ /^service:[[:space:]]*/) {
        if (current_host == expected_host) {
          service=line
          sub(/^service:[[:space:]]*/, "", service)
          print service
          exit
        }
      }
    }
  ' "$config_file"
}

for env_name in "${SELECTED_ENVS[@]}"; do
  host="$(host_for_env "$env_name")"
  require_host "$env_name" "$host"

  if [[ -f "$CONFIG_PATH" ]]; then
    expected_upstream="$(upstream_for_env "$env_name")"
    actual_upstream="$(resolve_config_upstream_for_host "$host" "$CONFIG_PATH")"
    if [[ "$actual_upstream" != "$expected_upstream" ]]; then
      echo "Tunnel route mismatch for ${host}. Expected '${expected_upstream}', got '${actual_upstream:-<missing>}'"
      exit 1
    fi
    echo "Tunnel route check passed for ${host} -> ${actual_upstream}"
  fi

  check_host "$host"
done
