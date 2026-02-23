#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$SCRIPT_DIR/lib/colors.sh"
source "$SCRIPT_DIR/lib/validation.sh"
source "$SCRIPT_DIR/lib/ports.sh"

if [[ $# -lt 1 ]]; then
  log_error "Usage: $0 <worktree-path>"
  exit 1
fi

WORKTREE_PATH="$1"
WORKTREE_NAME="$(basename "$WORKTREE_PATH")"

if ! validate_name "$WORKTREE_NAME" "worktree name"; then
  exit 1
fi

if [[ ! -d "$WORKTREE_PATH" ]]; then
  log_error "Worktree path does not exist: $WORKTREE_PATH"
  exit 1
fi

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/tx_agent_kit}"
if ! require_local_postgres_url "$DB_URL"; then
  exit 1
fi
SCHEMA_NAME="$(generate_schema_name "$WORKTREE_NAME")"

log_info "Ensuring infrastructure is running"
"$ROOT_DIR/scripts/start-dev-services.sh"

log_info "Creating schema '$SCHEMA_NAME' (idempotent)"
psql "$DB_URL" -v schema_name="$SCHEMA_NAME" <<'SQL'
\set quoted_schema :schema_name

DO $$
BEGIN
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', :'quoted_schema');
  EXECUTE format('GRANT ALL ON SCHEMA %I TO postgres', :'quoted_schema');
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO postgres', :'quoted_schema');
END $$;
SQL

WEB_PORT=""
API_PORT=""
MOBILE_PORT=""
WORKER_INSPECT_PORT=""
while IFS='=' read -r key value; do
  case "$key" in
    WEB_PORT)
      WEB_PORT="$value"
      ;;
    API_PORT)
      API_PORT="$value"
      ;;
    MOBILE_PORT)
      MOBILE_PORT="$value"
      ;;
    WORKER_INSPECT_PORT)
      WORKER_INSPECT_PORT="$value"
      ;;
  esac
done <<EOF
$(allocate_worktree_ports "$WORKTREE_NAME")
EOF

if [[ -z "$WEB_PORT" || -z "$API_PORT" || -z "$MOBILE_PORT" || -z "$WORKER_INSPECT_PORT" ]]; then
  log_error "Failed to derive deterministic worktree ports"
  exit 1
fi

if [[ ! -f "$WORKTREE_PATH/.env" ]]; then
  if [[ -f "$WORKTREE_PATH/.env.example" ]]; then
    cp "$WORKTREE_PATH/.env.example" "$WORKTREE_PATH/.env"
  else
    cp "$ROOT_DIR/.env.example" "$WORKTREE_PATH/.env"
  fi
fi

upsert_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -Eq "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi

  rm -f "${file}.bak"
}

WORKTREE_ENV="$WORKTREE_PATH/.env"
SCHEMA_QUERY="postgresql://postgres:postgres@localhost:5432/tx_agent_kit?options=-c%20search_path%3D${SCHEMA_NAME},public"

upsert_env_value "$WORKTREE_ENV" "DATABASE_URL" "$SCHEMA_QUERY"
upsert_env_value "$WORKTREE_ENV" "DATABASE_SCHEMA" "$SCHEMA_NAME"
upsert_env_value "$WORKTREE_ENV" "API_PORT" "$API_PORT"
upsert_env_value "$WORKTREE_ENV" "PORT" "$WEB_PORT"
upsert_env_value "$WORKTREE_ENV" "WEB_PORT" "$WEB_PORT"
upsert_env_value "$WORKTREE_ENV" "MOBILE_PORT" "$MOBILE_PORT"
upsert_env_value "$WORKTREE_ENV" "WORKER_INSPECT_PORT" "$WORKER_INSPECT_PORT"
upsert_env_value "$WORKTREE_ENV" "API_BASE_URL" "http://localhost:${API_PORT}"
upsert_env_value "$WORKTREE_ENV" "NEXT_PUBLIC_API_BASE_URL" "http://localhost:${API_PORT}"
upsert_env_value "$WORKTREE_ENV" "EXPO_PUBLIC_API_BASE_URL" "http://localhost:${API_PORT}"
upsert_env_value "$WORKTREE_ENV" "OTEL_EXPORTER_OTLP_ENDPOINT" "http://localhost:4320"
upsert_env_value "$WORKTREE_ENV" "NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT" "http://localhost:4320"
upsert_env_value "$WORKTREE_ENV" "EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT" "http://localhost:4320"
upsert_env_value "$WORKTREE_ENV" "NEXT_PUBLIC_NODE_ENV" "development"
upsert_env_value "$WORKTREE_ENV" "EXPO_PUBLIC_NODE_ENV" "development"
upsert_env_value "$WORKTREE_ENV" "API_CORS_ORIGIN" "http://localhost:${WEB_PORT}"

cat > "$WORKTREE_PATH/run-migrations.sh" <<MIGRATE
#!/usr/bin/env bash
set -euo pipefail
cd "$WORKTREE_PATH"
pnpm db:migrate
MIGRATE
chmod +x "$WORKTREE_PATH/run-migrations.sh"

cat > "$WORKTREE_PATH/reset-worktree-schema.sh" <<RESET
#!/usr/bin/env bash
set -euo pipefail
psql "${DB_URL}" -c "DROP SCHEMA IF EXISTS \"${SCHEMA_NAME}\" CASCADE;"
psql "${DB_URL}" -c "CREATE SCHEMA IF NOT EXISTS \"${SCHEMA_NAME}\";"
RESET
chmod +x "$WORKTREE_PATH/reset-worktree-schema.sh"

log_success "Worktree setup complete"
printf '  Worktree: %s\n' "$WORKTREE_NAME"
printf '  Schema:   %s\n' "$SCHEMA_NAME"
printf '  Web port: %s\n' "$WEB_PORT"
printf '  API port: %s\n' "$API_PORT"
printf '  Mobile port: %s\n' "$MOBILE_PORT"
printf '  Worker inspect port: %s\n' "$WORKER_INSPECT_PORT"
printf '  Env file: %s\n' "$WORKTREE_ENV"
