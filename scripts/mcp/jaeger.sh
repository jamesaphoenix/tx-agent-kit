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

: "${JAEGER_URL:=http://localhost}"
: "${JAEGER_PROTOCOL:=HTTP}"

jaeger_url_has_explicit_port() {
  local url="$1"
  [[ "$url" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+:[0-9]+($|/.*) ]] || [[ "$url" =~ ^[^/]+:[0-9]+($|/.*) ]]
}

if [[ -n "${JAEGER_PORT:-}" ]]; then
  if jaeger_url_has_explicit_port "$JAEGER_URL"; then
    echo "JAEGER_URL already includes an explicit port; ignoring JAEGER_PORT=$JAEGER_PORT." >&2
    unset JAEGER_PORT
  fi
else
  if ! jaeger_url_has_explicit_port "$JAEGER_URL"; then
    JAEGER_PORT=16686
  fi
fi

export JAEGER_URL
export JAEGER_PROTOCOL
if [[ -n "${JAEGER_PORT:-}" ]]; then
  export JAEGER_PORT
fi

if [[ "${JAEGER_MCP_DRY_RUN:-0}" == "1" ]]; then
  echo "JAEGER_URL=$JAEGER_URL"
  echo "JAEGER_PROTOCOL=$JAEGER_PROTOCOL"
  echo "JAEGER_PORT=${JAEGER_PORT:-}"
  exit 0
fi

exec npx -y jaeger-mcp-server@0.1.0
