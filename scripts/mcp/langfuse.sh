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

: "${LANGFUSE_BASE_URL:=http://localhost:3200}"
: "${LANGFUSE_PUBLIC_KEY:=pk-lf-local-dev}"
: "${LANGFUSE_SECRET_KEY:=sk-lf-local-dev}"

export LANGFUSE_BASE_URL
export LANGFUSE_PUBLIC_KEY
export LANGFUSE_SECRET_KEY

if [[ "${LANGFUSE_MCP_DRY_RUN:-0}" == "1" ]]; then
  echo "LANGFUSE_BASE_URL=$LANGFUSE_BASE_URL"
  echo "LANGFUSE_PUBLIC_KEY=$LANGFUSE_PUBLIC_KEY"
  echo "LANGFUSE_SECRET_KEY=<redacted>"
  exit 0
fi

LANGFUSE_API_BASE="${LANGFUSE_BASE_URL%/}/api/public"

langfuse_usage() {
  cat <<'EOF'
No official Langfuse MCP server npm package is available.
This wrapper provides Langfuse Public API helpers via curl.

Usage:
  scripts/mcp/langfuse.sh health
  scripts/mcp/langfuse.sh traces [query]
  scripts/mcp/langfuse.sh trace <traceId>
  scripts/mcp/langfuse.sh observations [query]
  scripts/mcp/langfuse.sh scores [query]

Endpoints:
  GET /api/public/health
  GET /api/public/traces
  GET /api/public/traces/:traceId
  GET /api/public/observations
  GET /api/public/scores

Examples:
  scripts/mcp/langfuse.sh health
  scripts/mcp/langfuse.sh traces "limit=10"
  scripts/mcp/langfuse.sh trace 0123456789abcdef0123456789abcdef
  scripts/mcp/langfuse.sh observations "name=planner&limit=20"
  scripts/mcp/langfuse.sh scores "name=quality&limit=20"
EOF
}

langfuse_url_with_query() {
  local endpoint="$1"
  local query="${2:-}"

  if [[ -z "$query" ]]; then
    echo "$endpoint"
    return 0
  fi

  if [[ "$query" == \?* ]]; then
    echo "${endpoint}${query}"
    return 0
  fi

  echo "${endpoint}?${query}"
}

langfuse_curl() {
  curl -fsS -u "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" "$@"
}

command="${1:-help}"
case "$command" in
  help|-h|--help)
    langfuse_usage
    ;;
  health)
    langfuse_curl "${LANGFUSE_API_BASE}/health"
    ;;
  traces)
    langfuse_curl "$(langfuse_url_with_query "${LANGFUSE_API_BASE}/traces" "${2:-}")"
    ;;
  trace)
    trace_id="${2:-}"
    if [[ -z "$trace_id" ]]; then
      echo "trace command requires a traceId argument." >&2
      exit 1
    fi
    langfuse_curl "${LANGFUSE_API_BASE}/traces/${trace_id}"
    ;;
  observations)
    langfuse_curl "$(langfuse_url_with_query "${LANGFUSE_API_BASE}/observations" "${2:-}")"
    ;;
  scores)
    langfuse_curl "$(langfuse_url_with_query "${LANGFUSE_API_BASE}/scores" "${2:-}")"
    ;;
  *)
    echo "Unknown command: $command" >&2
    langfuse_usage >&2
    exit 1
    ;;
esac
