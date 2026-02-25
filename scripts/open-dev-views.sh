#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

read_env_or_default() {
  local key="$1"
  local fallback="$2"
  local value="${!key:-}"

  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
    return
  fi

  if [[ -f .env ]]; then
    local env_line=""
    env_line="$(grep -E "^${key}=" .env | tail -n 1 || true)"
    if [[ -n "$env_line" ]]; then
      value="${env_line#*=}"
      value="${value%$'\r'}"

      if [[ "$value" == \"*\" && "$value" == *\" && "${#value}" -ge 2 ]]; then
        value="${value:1:${#value}-2}"
      fi

      if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
        return
      fi
    fi
  fi

  printf '%s\n' "$fallback"
}

open_urls_in_browser() {
  local browser="$1"
  shift
  open -a "$browser" "$@" >/dev/null 2>&1
}

WEB_PORT="$(read_env_or_default "WEB_PORT" "3000")"
API_PORT="$(read_env_or_default "API_PORT" "4000")"
MOBILE_PORT="$(read_env_or_default "MOBILE_PORT" "8081")"
MOBILE_DASHBOARD_PATH="$(read_env_or_default "MOBILE_DASHBOARD_PATH" "/status")"
TEMPORAL_CLI_UI_PORT="$(read_env_or_default "TEMPORAL_CLI_UI_PORT" "8233")"
TEMPORAL_CLI_ADDRESS="$(read_env_or_default "TEMPORAL_CLI_ADDRESS" "127.0.0.1")"
GRAFANA_PORT="$(read_env_or_default "GRAFANA_PORT" "3001")"
PROMETHEUS_PORT="$(read_env_or_default "PROMETHEUS_PORT" "9090")"
JAEGER_UI_PORT="$(read_env_or_default "JAEGER_UI_PORT" "16686")"

if [[ "$MOBILE_DASHBOARD_PATH" != /* ]]; then
  MOBILE_DASHBOARD_PATH="/${MOBILE_DASHBOARD_PATH}"
fi

if [[ "$TEMPORAL_CLI_ADDRESS" == "0.0.0.0" ]]; then
  TEMPORAL_CLI_ADDRESS="127.0.0.1"
fi

URLS=(
  "http://localhost:${WEB_PORT}"
  "http://localhost:${MOBILE_PORT}${MOBILE_DASHBOARD_PATH}"
  "http://localhost:${API_PORT}/docs"
  "http://${TEMPORAL_CLI_ADDRESS}:${TEMPORAL_CLI_UI_PORT}"
  "http://localhost:${GRAFANA_PORT}"
  "http://localhost:${PROMETHEUS_PORT}"
  "http://localhost:${JAEGER_UI_PORT}"
)

if open_urls_in_browser "Brave Browser" "${URLS[@]}"; then
  browser_used="Brave Browser"
elif open_urls_in_browser "Google Chrome" "${URLS[@]}"; then
  browser_used="Google Chrome"
else
  echo "Could not open URLs in Brave Browser or Google Chrome."
  echo "Install one of these browsers (or verify app names in /Applications) and rerun 'pnpm dev:open'."
  exit 1
fi

echo "Opened local dev views in ${browser_used}:"
for url in "${URLS[@]}"; do
  echo "  - ${url}"
done
