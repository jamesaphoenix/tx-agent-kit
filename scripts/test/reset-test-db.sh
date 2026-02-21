#!/usr/bin/env bash
# Ensures infra is running, applies migrations, then idempotently resets DB state.
# Containers remain running; only data tables are reset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_PROJECT_NAME="tx-agent-kit"
DB_NAME="${TX_AGENT_DB_NAME:-tx_agent_kit}"
LOCK_DIR="/tmp/tx-agent-kit-db-reset.lock"

cd "$PROJECT_ROOT"

"$PROJECT_ROOT/scripts/start-dev-services.sh"

acquire_lock() {
  local timeout_seconds=120
  local waited=0

  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if (( waited >= timeout_seconds )); then
      echo "Timed out waiting for DB reset lock: $LOCK_DIR"
      exit 1
    fi

    sleep 1
    waited=$((waited + 1))
  done
}

release_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

acquire_lock
trap release_lock EXIT

echo "Applying migrations..."
pnpm db:migrate

POSTGRES_CONTAINER_ID="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q postgres)"
if [[ -z "$POSTGRES_CONTAINER_ID" ]]; then
  echo "Postgres container is not running for compose project '$COMPOSE_PROJECT_NAME'."
  exit 1
fi

echo "Resetting test database state in '$DB_NAME'..."
docker exec -i "$POSTGRES_CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" <<'SQL'
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
    AND tablename <> '__drizzle_migrations';

  IF truncate_sql IS NOT NULL THEN
    EXECUTE truncate_sql;
  END IF;
END $$;

INSERT INTO roles (name)
VALUES ('owner'), ('admin'), ('member')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (key)
VALUES ('workspace.read'), ('workspace.write'), ('invite.manage'), ('task.manage')
ON CONFLICT (key) DO NOTHING;
SQL

echo "Database reset complete."
