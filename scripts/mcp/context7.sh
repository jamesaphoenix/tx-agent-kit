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

: "${CONTEXT7_TRANSPORT:=stdio}"

if [[ "$CONTEXT7_TRANSPORT" != "stdio" && "$CONTEXT7_TRANSPORT" != "http" ]]; then
  echo "Invalid CONTEXT7_TRANSPORT='$CONTEXT7_TRANSPORT'. Expected 'stdio' or 'http'." >&2
  exit 1
fi

CONTEXT7_ARGS=(
  -y
  @upstash/context7-mcp@latest
  --transport
  "$CONTEXT7_TRANSPORT"
)

if [[ -n "${CONTEXT7_API_KEY:-}" ]]; then
  CONTEXT7_ARGS+=(--api-key "$CONTEXT7_API_KEY")
fi

if [[ "$CONTEXT7_TRANSPORT" == "http" ]]; then
  : "${CONTEXT7_PORT:=3000}"
  CONTEXT7_ARGS+=(--port "$CONTEXT7_PORT")
fi

exec npx "${CONTEXT7_ARGS[@]}"
