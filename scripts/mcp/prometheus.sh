#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${MCP_ENV_FILE:-$ROOT_DIR/.env.mcp}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${PROMETHEUS_URL:=http://localhost:9090}"
export PROMETHEUS_URL

PROMETHEUS_IMAGE="${PROMETHEUS_MCP_IMAGE:-ghcr.io/pab1it0/prometheus-mcp-server:latest}"

DOCKER_ARGS=(
  run
  -i
  --rm
  -e PROMETHEUS_URL
  -e PROMETHEUS_URL_SSL_VERIFY
  -e PROMETHEUS_DISABLE_LINKS
  -e PROMETHEUS_REQUEST_TIMEOUT
  -e PROMETHEUS_USERNAME
  -e PROMETHEUS_PASSWORD
  -e PROMETHEUS_TOKEN
  -e ORG_ID
  -e PROMETHEUS_CUSTOM_HEADERS
  -e TOOL_PREFIX
  "$PROMETHEUS_IMAGE"
)

exec docker "${DOCKER_ARGS[@]}"
