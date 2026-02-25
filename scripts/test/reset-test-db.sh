#!/usr/bin/env bash
# Ensures infra is running, applies migrations, then idempotently resets DB state.
# Containers remain running; only data tables are reset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/lock.sh"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"
LOCK_DIR="/tmp/${COMPOSE_PROJECT_NAME}-db-reset.lock"

cd "$PROJECT_ROOT"

if [[ "${TX_AGENT_SKIP_INFRA_ENSURE:-0}" != "1" ]]; then
  "$PROJECT_ROOT/scripts/start-dev-services.sh"
fi

derive_db_name_from_url() {
  local database_url="${1:-}"
  if [[ -z "$database_url" ]]; then
    return 1
  fi

  local without_query="${database_url%%\?*}"
  local candidate="${without_query##*/}"
  if [[ -z "$candidate" || "$candidate" == "$without_query" ]]; then
    return 1
  fi

  printf '%s\n' "$candidate"
}

derive_db_host_from_url() {
  local database_url="${1:-}"
  if [[ -z "$database_url" ]]; then
    return 1
  fi

  local without_protocol="${database_url#postgresql://}"
  without_protocol="${without_protocol#postgres://}"
  local without_auth="${without_protocol#*@}"
  local host_port="${without_auth%%/*}"
  local host="${host_port%%:*}"
  host="${host#[}"
  host="${host%]}"
  printf '%s\n' "$host"
}

if derived_db_name="$(derive_db_name_from_url "${DATABASE_URL:-}")"; then
  DB_NAME="$derived_db_name"
else
  DB_NAME="${TX_AGENT_DB_NAME:-tx_agent_kit}"
fi

EXPECTED_DB_NAME="tx_agent_kit"
if [[ "$DB_NAME" != "$EXPECTED_DB_NAME" ]]; then
  echo "Refusing to reset database '$DB_NAME'. Expected '$EXPECTED_DB_NAME'."
  exit 1
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  if ! db_host="$(derive_db_host_from_url "$DATABASE_URL")"; then
    echo "Could not parse DATABASE_URL host. Refusing to continue."
    exit 1
  fi

  if [[ "$db_host" != "localhost" && "$db_host" != "127.0.0.1" && "$db_host" != "::1" ]]; then
    echo "Refusing to reset non-local DATABASE_URL host '$db_host'."
    exit 1
  fi
fi

lock_acquire \
  "$LOCK_DIR" \
  "${DB_RESET_LOCK_TIMEOUT_SECONDS:-900}" \
  "${DB_RESET_LOCK_MISSING_PID_GRACE_SECONDS:-15}"
trap 'lock_release "$LOCK_DIR"' EXIT

echo "Applying migrations..."
pnpm db:migrate

POSTGRES_CONTAINER_ID="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q postgres)"
if [[ -z "$POSTGRES_CONTAINER_ID" ]]; then
  echo "Postgres container is not running for compose project '$COMPOSE_PROJECT_NAME'."
  exit 1
fi

echo "Resetting test database state in '$DB_NAME'..."
docker exec -i "$POSTGRES_CONTAINER_ID" psql -1 -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" <<'SQL'
DO $$
DECLARE
  truncate_sql text;
BEGIN
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' RESTART IDENTITY CASCADE'
  END
  INTO truncate_sql
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> '__drizzle_migrations'
    AND tablename <> '__tx_agent_migrations';

  IF truncate_sql IS NOT NULL THEN
    EXECUTE truncate_sql;
  END IF;
END $$;

INSERT INTO roles (name)
VALUES ('owner'), ('admin'), ('member')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (key)
VALUES ('organization.read'), ('organization.write'), ('organization.manage'), ('invite.manage')
ON CONFLICT (key) DO NOTHING;
SQL

echo "Database reset complete."
