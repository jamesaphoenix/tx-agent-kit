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

# ---------------------------------------------------------------------------
# Phase 1: pure local wiring (no infra dependency — always runs)
# Port allocation, .env seeding, and helper script generation happen first so
# that a worktree is fully usable for file edits + type-check even when Docker
# is down. Infra-dependent steps run in Phase 2 as warn-not-fail.
# ---------------------------------------------------------------------------

WEB_PORT=""
API_PORT=""
MOBILE_PORT=""
WORKER_INSPECT_PORT=""
WORKTREE_PORT_OFFSET=""
ACTIVE_WORKTREE_NAMES=()
while IFS= read -r worktree_path; do
  worktree_base_name="$(basename "$worktree_path")"
  if [[ -n "$worktree_base_name" ]]; then
    ACTIVE_WORKTREE_NAMES+=("$worktree_base_name")
  fi
done < <(git -C "$ROOT_DIR" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')

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
    WORKTREE_PORT_OFFSET)
      WORKTREE_PORT_OFFSET="$value"
      ;;
  esac
done <<EOF
$(allocate_worktree_ports "$WORKTREE_NAME" "${ACTIVE_WORKTREE_NAMES[@]}")
EOF

if [[ -z "$WEB_PORT" || -z "$API_PORT" || -z "$MOBILE_PORT" || -z "$WORKER_INSPECT_PORT" || -z "$WORKTREE_PORT_OFFSET" ]]; then
  log_error "Failed to derive deterministic worktree ports"
  exit 1
fi

# Find the primary (non-worktree) checkout so we can seed real secrets from it.
# `git worktree list --porcelain` always lists the primary worktree first.
# Tolerate failure: when WORKTREE_PATH is not inside a git repo (e.g. a tmp
# directory used by integration tests), git exits non-zero and we fall back
# to seeding from .env.example.
PRIMARY_WORKTREE_PATH=""
if PRIMARY_WORKTREE_LIST="$(git -C "$WORKTREE_PATH" worktree list --porcelain 2>/dev/null)"; then
  PRIMARY_WORKTREE_PATH="$(printf '%s\n' "$PRIMARY_WORKTREE_LIST" | awk '/^worktree /{print $2; exit}')"
fi
PRIMARY_ENV=""
if [[ -n "$PRIMARY_WORKTREE_PATH" && "$PRIMARY_WORKTREE_PATH" != "$WORKTREE_PATH" && -f "$PRIMARY_WORKTREE_PATH/.env" ]]; then
  PRIMARY_ENV="$PRIMARY_WORKTREE_PATH/.env"
fi

if [[ ! -f "$WORKTREE_PATH/.env" ]]; then
  if [[ -n "$PRIMARY_ENV" ]]; then
    log_info "Seeding worktree .env from primary checkout: $PRIMARY_ENV"
    cp "$PRIMARY_ENV" "$WORKTREE_PATH/.env"
  elif [[ -f "$WORKTREE_PATH/.env.example" ]]; then
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
    local escaped_value
    escaped_value=$(printf '%s' "$value" | sed 's/[|&\\]/\\&/g')
    sed -i.bak "s|^${key}=.*|${key}=${escaped_value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi

  rm -f "${file}.bak"
}

# Replace an entire env line with a raw line from another file, preserving
# whatever quoting the source used. Used by the secret-healing loop so
# `PLAYWRIGHT_AUTH_NAME="Playwright MCP User"` stays quoted.
replace_env_line_raw() {
  local file="$1"
  local key="$2"
  local raw_line="$3"

  if grep -Eq "^${key}=" "$file"; then
    local escaped_line
    escaped_line=$(printf '%s' "$raw_line" | sed 's/[|&\\]/\\&/g')
    sed -i.bak "s|^${key}=.*|${escaped_line}|" "$file"
  else
    printf '\n%s\n' "$raw_line" >> "$file"
  fi

  rm -f "${file}.bak"
}

# Return 0 if the given line declares a non-empty env value. Handles:
#   KEY=value       (non-empty)
#   KEY="value"     (non-empty, quoted)
#   KEY=''          (empty, quoted)
#   KEY=""          (empty, quoted)
#   KEY=            (empty)
env_line_has_value() {
  local line="$1"
  local raw_value="${line#*=}"
  if [[ "$raw_value" == \"*\" ]]; then
    raw_value="${raw_value#\"}"
    raw_value="${raw_value%\"}"
  elif [[ "$raw_value" == \'*\' ]]; then
    raw_value="${raw_value#\'}"
    raw_value="${raw_value%\'}"
  fi
  [[ -n "$raw_value" ]]
}

# Heal empty/missing secret values by pulling them from the primary .env.
# Never overwrites a non-empty worktree value — preserves local overrides.
# Skips worktree-scoped keys (ports, schema, DB_URL) — those are upserted below.
if [[ -n "$PRIMARY_ENV" ]]; then
  WORKTREE_SCOPED_KEYS="^(DATABASE_URL|DATABASE_SCHEMA|WORKTREE_PORT_OFFSET|API_PORT|PORT|WEB_PORT|MOBILE_PORT|WORKER_INSPECT_PORT|TEMPORAL_TASK_QUEUE|API_BASE_URL|NEXT_PUBLIC_API_BASE_URL|EXPO_PUBLIC_API_BASE_URL|API_CORS_ORIGIN)$"

  while IFS= read -r primary_line || [[ -n "$primary_line" ]]; do
    [[ -z "$primary_line" ]] && continue
    [[ "$primary_line" =~ ^[[:space:]]*# ]] && continue
    [[ "$primary_line" != *"="* ]] && continue
    primary_key="${primary_line%%=*}"
    [[ ! "$primary_key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && continue
    env_line_has_value "$primary_line" || continue
    [[ "$primary_key" =~ $WORKTREE_SCOPED_KEYS ]] && continue

    worktree_line="$(grep -E "^${primary_key}=" "$WORKTREE_PATH/.env" || true)"
    if [[ -z "$worktree_line" ]] || ! env_line_has_value "$worktree_line"; then
      replace_env_line_raw "$WORKTREE_PATH/.env" "$primary_key" "$primary_line"
    fi
  done < "$PRIMARY_ENV"
fi

WORKTREE_ENV="$WORKTREE_PATH/.env"
SCHEMA_QUERY="postgresql://postgres:postgres@localhost:5432/tx_agent_kit?options=-c%20search_path%3D${SCHEMA_NAME},public"
WORKTREE_TASK_QUEUE="tx-agent-kit-${WORKTREE_NAME}"

upsert_env_value "$WORKTREE_ENV" "DATABASE_URL" "$SCHEMA_QUERY"
upsert_env_value "$WORKTREE_ENV" "DATABASE_SCHEMA" "$SCHEMA_NAME"
upsert_env_value "$WORKTREE_ENV" "WORKTREE_PORT_OFFSET" "$WORKTREE_PORT_OFFSET"
upsert_env_value "$WORKTREE_ENV" "API_PORT" "$API_PORT"
upsert_env_value "$WORKTREE_ENV" "PORT" "$WEB_PORT"
upsert_env_value "$WORKTREE_ENV" "WEB_PORT" "$WEB_PORT"
upsert_env_value "$WORKTREE_ENV" "MOBILE_PORT" "$MOBILE_PORT"
upsert_env_value "$WORKTREE_ENV" "WORKER_INSPECT_PORT" "$WORKER_INSPECT_PORT"
upsert_env_value "$WORKTREE_ENV" "TEMPORAL_TASK_QUEUE" "$WORKTREE_TASK_QUEUE"
# Isolate the email-campaigns task queue per worktree too, so a worktree's
# campaign worker never collides with another checkout's (Temporal version skew).
upsert_env_value "$WORKTREE_ENV" "EMAIL_CAMPAIGNS_TASK_QUEUE" "email-campaigns-${WORKTREE_NAME}"
upsert_env_value "$WORKTREE_ENV" "API_BASE_URL" "http://localhost:${API_PORT}"
upsert_env_value "$WORKTREE_ENV" "NEXT_PUBLIC_API_BASE_URL" "http://localhost:${API_PORT}"
upsert_env_value "$WORKTREE_ENV" "EXPO_PUBLIC_API_BASE_URL" "http://localhost:${API_PORT}"
upsert_env_value "$WORKTREE_ENV" "OTEL_EXPORTER_OTLP_ENDPOINT" "http://localhost:4320"
upsert_env_value "$WORKTREE_ENV" "OTEL_LOGS_EXPORTER" "otlp"
upsert_env_value "$WORKTREE_ENV" "NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT" "http://localhost:4320"
upsert_env_value "$WORKTREE_ENV" "EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT" "http://localhost:4320"
upsert_env_value "$WORKTREE_ENV" "NEXT_PUBLIC_NODE_ENV" "development"
upsert_env_value "$WORKTREE_ENV" "EXPO_PUBLIC_NODE_ENV" "development"
upsert_env_value "$WORKTREE_ENV" "API_CORS_ORIGIN" "http://localhost:${WEB_PORT}"
upsert_env_value "$WORKTREE_ENV" "SENTRY_SPOTLIGHT" "true"
upsert_env_value "$WORKTREE_ENV" "LOG_LEVEL" "debug"
upsert_env_value "$WORKTREE_ENV" "NODE_ENV" "development"

cat > "$WORKTREE_PATH/run-migrations.sh" <<MIGRATE
#!/usr/bin/env bash
set -euo pipefail
cd "$WORKTREE_PATH"
pnpm db:migrate
pnpm db:schemas:apply
MIGRATE
chmod +x "$WORKTREE_PATH/run-migrations.sh"

cat > "$WORKTREE_PATH/reset-worktree-schema.sh" <<RESET
#!/usr/bin/env bash
set -euo pipefail
psql "${DB_URL}" -c "DROP SCHEMA IF EXISTS \"${SCHEMA_NAME}\" CASCADE;"
psql "${DB_URL}" -c "CREATE SCHEMA IF NOT EXISTS \"${SCHEMA_NAME}\";"
RESET
chmod +x "$WORKTREE_PATH/reset-worktree-schema.sh"

# Share `tx` task state with the primary checkout. `.tx/tasks.db` is
# gitignored, so each worktree gets its own empty SQLite file the first
# time `tx` is invoked there. We instead symlink it to the primary
# checkout's database so agents working in a worktree see the same task
# queue + spec coverage as humans on main. `.tx/config.toml` and
# `.tx/.gitignore` are NOT symlinked — they are git-tracked and
# identical across checkouts; only the gitignored database file needs sharing.
if [[ -n "$PRIMARY_WORKTREE_PATH" && "$PRIMARY_WORKTREE_PATH" != "$WORKTREE_PATH" ]]; then
  PRIMARY_TX_DB="$PRIMARY_WORKTREE_PATH/.tx/tasks.db"
  WORKTREE_TX_DIR="$WORKTREE_PATH/.tx"
  if [[ -d "$WORKTREE_TX_DIR" && -f "$PRIMARY_TX_DB" ]]; then
    rm -f "$WORKTREE_TX_DIR/tasks.db" "$WORKTREE_TX_DIR/tasks.db-shm" "$WORKTREE_TX_DIR/tasks.db-wal"
    ln -s "$PRIMARY_TX_DB" "$WORKTREE_TX_DIR/tasks.db"
    log_info "Linked .tx/tasks.db → primary checkout"
  fi
fi

if [[ -f "$WORKTREE_PATH/pnpm-workspace.yaml" && -f "$WORKTREE_PATH/package.json" ]]; then
  log_info "Installing worktree dependencies"
  (cd "$WORKTREE_PATH" && pnpm install)
else
  log_warn "Skipping dependency install; no pnpm workspace manifest found in $WORKTREE_PATH"
fi

# ---------------------------------------------------------------------------
# Phase 2: infra-dependent bring-up (warn-not-fail)
# Each step is non-fatal so a worktree remains usable when Docker/Postgres is
# down. The user can rerun `pnpm infra:ensure` + `./run-migrations.sh` later.
# ---------------------------------------------------------------------------

INFRA_WARNINGS=()

warn_infra() {
  local msg="$1"
  log_warn "$msg"
  INFRA_WARNINGS+=("$msg")
}

log_info "Ensuring infrastructure is running"
if ! "$ROOT_DIR/scripts/start-dev-services.sh"; then
  warn_infra "infra:ensure failed — run 'pnpm infra:ensure' once Docker is up"
fi

if [[ "${TEMPORAL_RUNTIME_MODE:-cli}" == "cli" ]]; then
  log_info "Ensuring local Temporal CLI runtime"
  if ! "$ROOT_DIR/scripts/temporal/start-dev.sh"; then
    warn_infra "temporal dev server failed — rerun scripts/temporal/start-dev.sh later"
  fi
fi

log_info "Creating schema '$SCHEMA_NAME' (idempotent)"
QUOTED_SCHEMA="$(quote_identifier "$SCHEMA_NAME")"
if ! psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
CREATE SCHEMA IF NOT EXISTS $QUOTED_SCHEMA;
GRANT ALL ON SCHEMA $QUOTED_SCHEMA TO postgres;
GRANT USAGE ON SCHEMA $QUOTED_SCHEMA TO postgres;
SQL
then
  warn_infra "schema creation skipped — run './reset-worktree-schema.sh' once Postgres is up"
fi

log_success "Worktree setup complete"
printf '  Worktree: %s\n' "$WORKTREE_NAME"
printf '  Schema:   %s\n' "$SCHEMA_NAME"
printf '  Port offset: %s\n' "$WORKTREE_PORT_OFFSET"
printf '  Web port: %s\n' "$WEB_PORT"
printf '  API port: %s\n' "$API_PORT"
printf '  Mobile port: %s\n' "$MOBILE_PORT"
printf '  Worker inspect port: %s\n' "$WORKER_INSPECT_PORT"
printf '  Temporal task queue: %s\n' "$WORKTREE_TASK_QUEUE"
printf '  Env file: %s\n' "$WORKTREE_ENV"

if [[ ${#INFRA_WARNINGS[@]} -gt 0 ]]; then
  printf '\n'
  log_warn "Worktree is wired but infra bring-up had issues:"
  for warning in "${INFRA_WARNINGS[@]}"; do
    printf '    - %s\n' "$warning"
  done
fi
