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

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is required for Supabase MCP." >&2
  exit 1
fi

SUPABASE_ARGS=(
  -y
  @supabase/mcp-server-supabase@latest
  --access-token
  "$SUPABASE_ACCESS_TOKEN"
)

if [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  SUPABASE_ARGS+=(--project-ref "$SUPABASE_PROJECT_REF")
fi

if [[ -n "${SUPABASE_API_URL:-}" ]]; then
  SUPABASE_ARGS+=(--api-url "$SUPABASE_API_URL")
fi

if [[ -n "${SUPABASE_MCP_FEATURES:-}" ]]; then
  SUPABASE_ARGS+=(--features "$SUPABASE_MCP_FEATURES")
fi

case "${SUPABASE_MCP_READ_ONLY:-true}" in
  true|TRUE|1|yes|YES)
    SUPABASE_ARGS+=(--read-only)
    ;;
  false|FALSE|0|no|NO)
    ;;
  *)
    echo "Invalid SUPABASE_MCP_READ_ONLY='${SUPABASE_MCP_READ_ONLY}'. Use true or false." >&2
    exit 1
    ;;
esac

exec npx "${SUPABASE_ARGS[@]}"
