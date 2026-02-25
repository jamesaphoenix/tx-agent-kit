#!/usr/bin/env bash
# Idempotently configure local env files for development.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

upsert_key() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -Eq "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$file"
  fi

  rm -f "${file}.bak"
}

ensure_key_if_missing() {
  local file="$1"
  local key="$2"
  local value="${3:-}"

  if ! grep -Eq "^${key}=" "$file"; then
    printf "\n%s=%s\n" "$key" "$value" >> "$file"
  fi
}

ensure_file() {
  local source_file="$1"
  local target_file="$2"

  if [[ ! -f "$target_file" ]]; then
    cp "$source_file" "$target_file"
  fi
}

ensure_file ".env.example" ".env"

upsert_key ".env" "NODE_ENV" "development"
upsert_key ".env" "API_PORT" "4000"
upsert_key ".env" "API_HOST" "0.0.0.0"
upsert_key ".env" "DATABASE_URL" "postgres://postgres:postgres@localhost:5432/tx_agent_kit"
upsert_key ".env" "AUTH_SECRET" "local-dev-auth-secret-123456"
upsert_key ".env" "API_CORS_ORIGIN" "http://localhost:3000"
upsert_key ".env" "API_BASE_URL" "http://localhost:4000"
upsert_key ".env" "TEMPORAL_RUNTIME_MODE" "cli"
upsert_key ".env" "TEMPORAL_ADDRESS" "localhost:7233"
upsert_key ".env" "TEMPORAL_NAMESPACE" "default"
upsert_key ".env" "TEMPORAL_TASK_QUEUE" "tx-agent-kit"
upsert_key ".env" "TEMPORAL_TLS_ENABLED" "false"
ensure_key_if_missing ".env" "TEMPORAL_API_KEY"
ensure_key_if_missing ".env" "TEMPORAL_TLS_SERVER_NAME"
ensure_key_if_missing ".env" "TEMPORAL_CLOUD_TEST_ADDRESS"
ensure_key_if_missing ".env" "TEMPORAL_CLOUD_TEST_NAMESPACE"
ensure_key_if_missing ".env" "TEMPORAL_CLOUD_TEST_API_KEY"
upsert_key ".env" "OTEL_EXPORTER_OTLP_ENDPOINT" "http://localhost:4318"
upsert_key ".env" "OTEL_LOGS_EXPORTER" "otlp"
upsert_key ".env" "PROMETHEUS_URL" "http://host.docker.internal:9090"
upsert_key ".env" "JAEGER_URL" "http://localhost"
upsert_key ".env" "JAEGER_PROTOCOL" "HTTP"
upsert_key ".env" "JAEGER_PORT" "16686"
upsert_key ".env" "CONTEXT7_TRANSPORT" "stdio"
upsert_key ".env" "SUPABASE_MCP_READ_ONLY" "true"
upsert_key ".env" "PLAYWRIGHT_MCP_HEADLESS" "true"
upsert_key ".env" "PLAYWRIGHT_MCP_ISOLATED" "true"
ensure_key_if_missing ".env" "CONTEXT7_API_KEY"
ensure_key_if_missing ".env" "CONTEXT7_PORT"
ensure_key_if_missing ".env" "SUPABASE_ACCESS_TOKEN"
ensure_key_if_missing ".env" "SUPABASE_PROJECT_REF"
ensure_key_if_missing ".env" "SUPABASE_API_URL"
ensure_key_if_missing ".env" "SUPABASE_MCP_FEATURES"
ensure_key_if_missing ".env" "PLAYWRIGHT_MCP_BROWSER"
ensure_key_if_missing ".env" "PLAYWRIGHT_MCP_CAPS"
ensure_key_if_missing ".env" "PLAYWRIGHT_MCP_OUTPUT_DIR"
ensure_key_if_missing ".env" "PLAYWRIGHT_MCP_STORAGE_STATE" ".artifacts/playwright-mcp/storage-state.json"
ensure_key_if_missing ".env" "PLAYWRIGHT_AUTH_EMAIL"
ensure_key_if_missing ".env" "PLAYWRIGHT_AUTH_PASSWORD"
ensure_key_if_missing ".env" "PLAYWRIGHT_AUTH_NAME" "Playwright MCP User"
ensure_key_if_missing ".env" "PLAYWRIGHT_AUTH_SITE_URL" "http://localhost:3000"
ensure_key_if_missing ".env" "PLAYWRIGHT_AUTH_API_BASE_URL" "http://localhost:4000"
ensure_key_if_missing ".env" "PLAYWRIGHT_AUTH_ALLOW_PROD" "false"

echo "Local env file configured: .env"
