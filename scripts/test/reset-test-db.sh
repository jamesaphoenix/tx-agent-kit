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

  db_host_allowed=0
  case "$db_host" in
    localhost|127.0.0.1|::1|db|postgres|"${COMPOSE_PROJECT_NAME}-db"|"${COMPOSE_PROJECT_NAME}-postgres")
      db_host_allowed=1
      ;;
  esac

  if [[ "$db_host_allowed" -eq 0 && -n "${TX_AGENT_ALLOWED_DB_HOSTS:-}" ]]; then
    IFS=',' read -r -a additional_db_hosts <<<"${TX_AGENT_ALLOWED_DB_HOSTS}"
    for additional_db_host in "${additional_db_hosts[@]}"; do
      trimmed_db_host="${additional_db_host#"${additional_db_host%%[![:space:]]*}"}"
      trimmed_db_host="${trimmed_db_host%"${trimmed_db_host##*[![:space:]]}"}"
      if [[ -n "$trimmed_db_host" && "$db_host" == "$trimmed_db_host" ]]; then
        db_host_allowed=1
        break
      fi
    done
  fi

  if [[ "$db_host_allowed" -eq 0 ]]; then
    echo "Refusing to reset non-local DATABASE_URL host '$db_host'."
    exit 1
  fi
fi

lock_acquire \
  "$LOCK_DIR" \
  "${DB_RESET_LOCK_TIMEOUT_SECONDS:-900}" \
  "${DB_RESET_LOCK_MISSING_PID_GRACE_SECONDS:-15}"
trap 'lock_release "$LOCK_DIR"' EXIT

POSTGRES_CONTAINER_ID="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q postgres)"
if [[ -z "$POSTGRES_CONTAINER_ID" ]]; then
  echo "Postgres container is not running for compose project '$COMPOSE_PROJECT_NAME'."
  exit 1
fi

# Garbage-collect leaked per-run test schemas (killed runs skip teardown and
# leave their schema behind; the CI database accumulated 12,240 of them by
# 2026-06-12). Best-effort hygiene: a GC failure must not fail the reset.
echo "Garbage-collecting leaked test schemas..."
if ! sed "s/__MAX_AGE_HOURS__/${TEST_SCHEMA_GC_MAX_AGE_HOURS:-24}/g" ./scripts/test/gc-test-schemas.sql |
  docker exec -i "$POSTGRES_CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME"; then
  echo "Schema GC failed (non-fatal); continuing."
fi

# Ensure the shared updated_at trigger function exists in `public` BEFORE
# migrating. Migration 0034 guards its creation with an unqualified
# `pg_proc WHERE proname = 'set_updated_at'` check that matches the function in
# ANY schema. On a long-lived DB the runner keeps other schemas that already
# define it (protected `wt_*` worktree schemas, `public` itself, recent per-run
# schemas the age-based GC does not drop), so on a freshly migrated `public`
# the guard finds a stray copy, skips creation, and the follow-up CREATE TRIGGER
# fails with "function set_updated_at() does not exist". Pre-creating it in
# `public` (idempotent) makes the trigger resolve regardless of stray copies.
# This is a test-harness concern only (many schemas share one Postgres
# instance); single-schema prod/staging DBs are unaffected, so migration 0034
# is deliberately left untouched (editing an applied migration would risk a
# drizzle hash mismatch on databases that already ran it).
echo "Ensuring set_updated_at() exists in public before migrate..."
docker exec -i "$POSTGRES_CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" <<'SQL'
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
SQL

# Respect DATABASE_SCHEMA as the migration baseline. Worktrees and CI runner
# slots point DATABASE_URL's search_path at a dedicated schema (wt_<name> /
# wt_ci_txak_slot<N>); create it before `db:migrate` so the first CREATE TABLE
# has a target. The primary checkout falls through to `public` (always exists).
# render-reset-public-sql.ts already scopes its reset to DATABASE_SCHEMA.
BASELINE_SCHEMA="${DATABASE_SCHEMA:-public}"
echo "Ensuring baseline schema '$BASELINE_SCHEMA' exists before migrate..."
docker exec -i "$POSTGRES_CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" \
  -c "CREATE SCHEMA IF NOT EXISTS \"$BASELINE_SCHEMA\";"

echo "Applying migrations..."
pnpm db:migrate

echo "Resetting test database state in '$DB_NAME'..."
pnpm --silent exec tsx ./scripts/test/render-reset-public-sql.ts |
  docker exec -i "$POSTGRES_CONTAINER_ID" psql -1 -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME"

echo "Reapplying desired-state schemas..."
pnpm db:schemas:apply

echo "Database reset complete."
