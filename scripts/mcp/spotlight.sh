#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${MCP_ENV_FILE:-$ROOT_DIR/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${SPOTLIGHT_PORT:=8969}"

if [[ "${SPOTLIGHT_MCP_DRY_RUN:-0}" == "1" ]]; then
  echo "SPOTLIGHT_PORT=$SPOTLIGHT_PORT"
  exit 0
fi

# Verify the Spotlight sidecar is reachable before starting the MCP server.
if ! curl -fsS --connect-timeout 2 --max-time 3 "http://localhost:${SPOTLIGHT_PORT}" >/dev/null 2>&1; then
  echo "Spotlight sidecar is not reachable at http://localhost:${SPOTLIGHT_PORT}." >&2
  echo "Start it with: pnpm infra:ensure (or run the native desktop app)." >&2
  exit 1
fi

exec npx -y --prefer-online @spotlightjs/spotlight@latest mcp -p "$SPOTLIGHT_PORT"
