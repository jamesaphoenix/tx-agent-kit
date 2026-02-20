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

: "${JAEGER_URL:=http://localhost:16686}"
: "${JAEGER_PROTOCOL:=HTTP}"
: "${JAEGER_PORT:=16686}"
export JAEGER_URL
export JAEGER_PROTOCOL
export JAEGER_PORT

exec npx -y jaeger-mcp-server@0.1.0
