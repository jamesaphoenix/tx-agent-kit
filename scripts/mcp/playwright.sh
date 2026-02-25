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

PLAYWRIGHT_ARGS=(
  -y
  @playwright/mcp@latest
)

if [[ -n "${PLAYWRIGHT_MCP_BROWSER:-}" ]]; then
  PLAYWRIGHT_ARGS+=(--browser "$PLAYWRIGHT_MCP_BROWSER")
fi

if [[ -n "${PLAYWRIGHT_MCP_CAPS:-}" ]]; then
  PLAYWRIGHT_ARGS+=(--caps "$PLAYWRIGHT_MCP_CAPS")
fi

if [[ -n "${PLAYWRIGHT_MCP_OUTPUT_DIR:-}" ]]; then
  PLAYWRIGHT_ARGS+=(--output-dir "$PLAYWRIGHT_MCP_OUTPUT_DIR")
fi

if [[ -n "${PLAYWRIGHT_MCP_STORAGE_STATE:-}" ]]; then
  if [[ -f "$PLAYWRIGHT_MCP_STORAGE_STATE" ]]; then
    PLAYWRIGHT_ARGS+=(--storage-state "$PLAYWRIGHT_MCP_STORAGE_STATE")
  else
    echo "Warning: PLAYWRIGHT_MCP_STORAGE_STATE is set but file was not found: $PLAYWRIGHT_MCP_STORAGE_STATE" >&2
  fi
fi

case "${PLAYWRIGHT_MCP_HEADLESS:-true}" in
  true|TRUE|1|yes|YES)
    PLAYWRIGHT_ARGS+=(--headless)
    ;;
  false|FALSE|0|no|NO)
    ;;
  *)
    echo "Invalid PLAYWRIGHT_MCP_HEADLESS='${PLAYWRIGHT_MCP_HEADLESS}'. Use true or false." >&2
    exit 1
    ;;
esac

case "${PLAYWRIGHT_MCP_ISOLATED:-true}" in
  true|TRUE|1|yes|YES)
    PLAYWRIGHT_ARGS+=(--isolated)
    ;;
  false|FALSE|0|no|NO)
    ;;
  *)
    echo "Invalid PLAYWRIGHT_MCP_ISOLATED='${PLAYWRIGHT_MCP_ISOLATED}'. Use true or false." >&2
    exit 1
    ;;
esac

exec npx "${PLAYWRIGHT_ARGS[@]}"
