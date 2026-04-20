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
  pnpm db:migrate >/dev/null
  pnpm db:schemas:apply >/dev/null
fi

POSTGRES_CONTAINER_ID="$(docker compose -p "$COMPOSE_PROJECT_NAME" ps -q postgres)"
if [[ -z "$POSTGRES_CONTAINER_ID" ]]; then
  echo "Postgres container is not running for compose project '$COMPOSE_PROJECT_NAME'."
  exit 1
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

# Resolve target schema for the pgTAP session. The primary checkout uses
# `public`; worktrees set DATABASE_SCHEMA=wt_<name> via setup.sh, and the
# reconcile-schemas step only installs triggers into that schema, so running
# pgTAP against the default `public` search_path would see stale/missing
# triggers. Prefix each script with a `SET search_path` statement to match
# the schema where migrations and reconciled triggers actually live.
PGTAP_SCHEMA="${DATABASE_SCHEMA:-public}"

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
