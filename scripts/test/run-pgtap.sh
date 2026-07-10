#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/lock.sh"

# Pick up DATABASE_SCHEMA (and DATABASE_URL) from the worktree .env when the
# caller hasn't already exported it. The primary checkout leaves these unset;
# worktrees write them during setup.sh so pgTAP runs in the worktree schema.
if [[ -z "${DATABASE_SCHEMA:-}" && -f "$PROJECT_ROOT/.env" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      DATABASE_SCHEMA|DATABASE_URL)
        # Strip optional surrounding quotes
        value="${value%\"}"
        value="${value#\"}"
        export "$key=$value"
        ;;
    esac
  done < <(grep -E '^(DATABASE_SCHEMA|DATABASE_URL)=' "$PROJECT_ROOT/.env" || true)
fi
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"
DB_NAME="${TX_AGENT_DB_NAME:-tx_agent_kit}"
EXPECTED_DB_NAME="tx_agent_kit"
if [[ "$DB_NAME" != "$EXPECTED_DB_NAME" ]]; then
  echo "Refusing to run pgTAP against database '$DB_NAME'. Expected '$EXPECTED_DB_NAME'."
  exit 1
fi
PGTAP_DIR="$PROJECT_ROOT/packages/infra/db/pgtap"
LOCK_DIR="/tmp/${COMPOSE_PROJECT_NAME}-db-reset.lock"
SKIP_SETUP="false"

# Env-first target schema + rebuild toggle. Defaults preserve the pre-slot
# behaviour: primary checkout runs against `public`, worktrees against their
# DATABASE_SCHEMA, and neither rebuilds. CI runner slots override both
# (PGTAP_SCHEMA=pgtap_txak_slot<N>, PGTAP_REBUILD_SCHEMA=true) so pgTAP gets a
# DEDICATED schema rebuilt from scratch, isolated from the slot's app schema
# and from sibling repos sharing this Postgres.
PGTAP_SCHEMA="${PGTAP_SCHEMA:-${DATABASE_SCHEMA:-public}}"
PGTAP_REBUILD_SCHEMA="${PGTAP_REBUILD_SCHEMA:-false}"

# Never rebuild `public` destructively: DROP SCHEMA public CASCADE would take
# out the shared extensions every other schema depends on.
if [[ "$PGTAP_SCHEMA" == "public" && "$PGTAP_REBUILD_SCHEMA" == "true" ]]; then
  PGTAP_REBUILD_SCHEMA="false"
fi

if [[ ! "$PGTAP_SCHEMA" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "Refusing to run pgTAP against invalid schema name '$PGTAP_SCHEMA'."
  exit 1
fi

if [[ "${1:-}" == "--skip-setup" ]]; then
  SKIP_SETUP="true"
  shift
fi

if [[ "$#" -gt 0 ]]; then
  echo "Unknown arguments: $*"
  echo "Usage: ./scripts/test/run-pgtap.sh [--skip-setup]"
  exit 1
fi

cd "$PROJECT_ROOT"

lock_acquire \
  "$LOCK_DIR" \
  "${DB_RESET_LOCK_TIMEOUT_SECONDS:-900}" \
  "${DB_RESET_LOCK_MISSING_PID_GRACE_SECONDS:-15}"
trap 'lock_release "$LOCK_DIR"' EXIT

if [[ "$SKIP_SETUP" != "true" ]]; then
  "$PROJECT_ROOT/scripts/start-dev-services.sh"
fi

POSTGRES_CONTAINER_ID="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q postgres)"
if [[ -z "$POSTGRES_CONTAINER_ID" ]]; then
  echo "Postgres container is not running for compose project '$COMPOSE_PROJECT_NAME'."
  exit 1
fi

run_schema_scoped_sql_file() {
  local sql_file="$1"
  {
    printf 'SET search_path TO "%s", public;\n' "$PGTAP_SCHEMA"
    cat "$sql_file"
  } |
    docker exec -i "$POSTGRES_CONTAINER_ID" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" -f - >/dev/null
}

apply_pgtap_schema_sql() {
  local sql_file

  echo "Applying pgTAP migration SQL files..."
  while IFS= read -r sql_file; do
    run_schema_scoped_sql_file "$sql_file"
  done < <(find "$PROJECT_ROOT/packages/infra/db/drizzle/migrations" -maxdepth 1 -type f -name '*.sql' | sort)

  echo "Applying pgTAP desired-state SQL files..."
  while IFS= read -r sql_file; do
    run_schema_scoped_sql_file "$sql_file"
  done < <(find "$PROJECT_ROOT/packages/infra/db/schemas" -type f -name '*.sql' | sort)
}

rebuild_target_schema() {
  echo "Rebuilding pgTAP target schema '$PGTAP_SCHEMA'..."
  docker exec -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" \
      -c "DROP SCHEMA IF EXISTS \"$PGTAP_SCHEMA\" CASCADE; CREATE SCHEMA \"$PGTAP_SCHEMA\";"
}

schema_has_core_tables() {
  local result
  result="$(
    docker exec -i "$POSTGRES_CONTAINER_ID" \
      psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" \
        -c "SELECT to_regclass(format('%I.%I', '$PGTAP_SCHEMA', 'users')) IS NOT NULL;"
  )"

  [[ "$result" == "t" ]]
}

if [[ "$SKIP_SETUP" != "true" ]]; then
  if [[ "$PGTAP_REBUILD_SCHEMA" == "true" ]]; then
    # Dedicated pgTAP schema (CI runner slots): build it from scratch by
    # replaying the raw migration + desired-state SQL with a search_path
    # prefix. Replaying over an already-drizzle-migrated schema is not
    # idempotent (early migrations reference columns later ones renamed), so
    # the DROP+CREATE gives a clean target every run.
    rebuild_target_schema
    apply_pgtap_schema_sql

    if ! schema_has_core_tables; then
      echo "pgTAP target schema '$PGTAP_SCHEMA' is missing core tables after rebuild; retrying once..."
      rebuild_target_schema
      apply_pgtap_schema_sql
    fi

    if ! schema_has_core_tables; then
      echo "pgTAP target schema '$PGTAP_SCHEMA' is still missing core tables after rebuild."
      exit 1
    fi
  else
    # App schema path (primary checkout / worktree): pgTAP reads the schema the
    # normal migrate + reconcile just built.
    pnpm db:migrate >/dev/null
    pnpm db:schemas:apply >/dev/null
  fi
fi

if ! docker exec -i "$POSTGRES_CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pgtap;" >/dev/null; then
  echo "Failed to create pgtap extension in '$DB_NAME'."
  echo "If postgres was already running before pgtap image changes, rebuild it:"
  echo "  docker compose -p $COMPOSE_PROJECT_NAME up -d --build postgres"
  exit 1
fi

if [[ ! -d "$PGTAP_DIR" ]]; then
  echo "No pgTAP directory found at '$PGTAP_DIR'."
  exit 0
fi

PGTAP_FILES=()
while IFS= read -r sql_file; do
  PGTAP_FILES+=("$sql_file")
done < <(find "$PGTAP_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ "${#PGTAP_FILES[@]}" -eq 0 ]]; then
  echo "No pgTAP SQL files found in '$PGTAP_DIR'."
  exit 0
fi

# PGTAP_SCHEMA was resolved above (env-first, then DATABASE_SCHEMA, then
# `public`). The reconcile-schemas step only installs triggers into that
# schema, so prefix each script with a `SET search_path` statement to match
# the schema where migrations and reconciled triggers actually live.
echo "Running pgTAP suites (${#PGTAP_FILES[@]} files) against schema '$PGTAP_SCHEMA'..."
for sql_file in "${PGTAP_FILES[@]}"; do
  relative_sql_file="${sql_file#$PROJECT_ROOT/}"
  echo
  echo "==> $relative_sql_file"
  tap_output="$(
    {
      printf 'SET search_path TO "%s", public;\n' "$PGTAP_SCHEMA"
      cat "$sql_file"
    } |
    docker exec -i "$POSTGRES_CONTAINER_ID" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" -f -
  )"

  printf '%s\n' "$tap_output"

  if printf '%s\n' "$tap_output" | grep -Eq '^[[:space:]]*not ok'; then
    echo
    echo "pgTAP assertion failure detected in $sql_file"
    exit 1
  fi
done

echo
echo "pgTAP suites passed."
