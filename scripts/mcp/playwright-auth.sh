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

export PLAYWRIGHT_MCP_STORAGE_STATE="${PLAYWRIGHT_MCP_STORAGE_STATE:-.artifacts/playwright-mcp/storage-state.json}"

node "$ROOT_DIR/scripts/playwright/bootstrap-auth-storage-state.mjs"

exec "$ROOT_DIR/scripts/mcp/playwright.sh"
