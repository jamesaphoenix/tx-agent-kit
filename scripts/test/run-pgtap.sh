#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/lock.sh"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"
DB_NAME="${TX_AGENT_DB_NAME:-tx_agent_kit}"
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

echo "Running pgTAP suites (${#PGTAP_FILES[@]} files)..."
for sql_file in "${PGTAP_FILES[@]}"; do
  relative_sql_file="${sql_file#$PROJECT_ROOT/}"
  echo
  echo "==> $relative_sql_file"
  tap_output="$(
    docker exec -i "$POSTGRES_CONTAINER_ID" \
      psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" -f - < "$sql_file"
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
