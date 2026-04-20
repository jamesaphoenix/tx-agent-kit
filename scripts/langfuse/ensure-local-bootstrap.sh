#!/usr/bin/env bash
# Ensure the local Langfuse Docker stack has a deterministic dev user,
# organization, project, and project membership. Langfuse's headless
# initialization creates these on first boot; this script also repairs
# existing local volumes so the documented login remains reliable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"

cd "$PROJECT_ROOT"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

container_id_for() {
  local service="$1"
  docker compose -p "$COMPOSE_PROJECT_NAME" ps -q "$service" 2>/dev/null || true
}

container_env_or_default() {
  local container_id="$1"
  local key="$2"
  local fallback="$3"
  local value

  value="$(docker exec "$container_id" printenv "$key" 2>/dev/null || true)"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$fallback"
  fi
}

require_cmd docker
require_cmd node

postgres_container_id="$(container_id_for "langfuse-postgres")"
web_container_id="$(container_id_for "langfuse-web")"

if [[ -z "$postgres_container_id" || -z "$web_container_id" ]]; then
  echo "Langfuse containers are not running. Start them with: pnpm infra:ensure" >&2
  exit 1
fi

if ! docker exec "$postgres_container_id" pg_isready -U langfuse -d langfuse >/dev/null 2>&1; then
  echo "Langfuse Postgres is not ready yet." >&2
  exit 1
fi

org_id="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_ORG_ID" "tx-agent-kit-local")"
org_name="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_ORG_NAME" "tx-agent-kit Local")"
project_id="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_PROJECT_ID" "tx-agent-kit-local")"
project_name="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_PROJECT_NAME" "tx-agent-kit Local")"
public_key="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_PROJECT_PUBLIC_KEY" "pk-lf-00000000-0000-4000-8000-000000000000")"
user_email="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_USER_EMAIL" "dev@tx-agent-kit.local")"
user_name="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_USER_NAME" "tx-agent-kit Dev")"
user_password="$(container_env_or_default "$web_container_id" "LANGFUSE_INIT_USER_PASSWORD" "tx-agent-kit-local-langfuse")"

if [[ -z "$user_password" ]]; then
  echo "LANGFUSE_INIT_USER_PASSWORD must not be empty for local bootstrap." >&2
  exit 1
fi

password_hash="$(
  LANGFUSE_LOCAL_BOOTSTRAP_PASSWORD="$user_password" node --input-type=module <<'NODE'
import bcrypt from './packages/infra/auth/node_modules/bcryptjs/index.js'

const password = process.env.LANGFUSE_LOCAL_BOOTSTRAP_PASSWORD
if (!password) {
  process.exit(1)
}

console.log(await bcrypt.hash(password, 12))
NODE
)"

docker exec -i "$postgres_container_id" psql -v ON_ERROR_STOP=1 \
  -U langfuse \
  -d langfuse \
  -v org_id="$org_id" \
  -v org_name="$org_name" \
  -v project_id="$project_id" \
  -v project_name="$project_name" \
  -v public_key="$public_key" \
  -v user_email="$user_email" \
  -v user_name="$user_name" \
  -v password_hash="$password_hash" <<'SQL' >/dev/null
BEGIN;

INSERT INTO organizations (id, name)
VALUES (:'org_id', :'org_name')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO projects (id, name, org_id, deleted_at)
VALUES (:'project_id', :'project_name', :'org_id', NULL)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    org_id = EXCLUDED.org_id,
    deleted_at = NULL,
    updated_at = CURRENT_TIMESTAMP;

WITH existing_user AS (
  SELECT id
  FROM users
  WHERE email = :'user_email'
),
inserted_user AS (
  INSERT INTO users (id, email, name, password, email_verified)
  SELECT 'tx-agent-kit-local-user', :'user_email', :'user_name', :'password_hash', CURRENT_TIMESTAMP
  WHERE NOT EXISTS (SELECT 1 FROM existing_user)
  RETURNING id
),
target_user AS (
  SELECT id FROM existing_user
  UNION ALL
  SELECT id FROM inserted_user
  LIMIT 1
)
UPDATE users
SET name = :'user_name',
    password = :'password_hash',
    email_verified = COALESCE(email_verified, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE id = (SELECT id FROM target_user);

WITH target_user AS (
  SELECT id
  FROM users
  WHERE email = :'user_email'
)
INSERT INTO organization_memberships (id, org_id, user_id, role)
SELECT 'tx-agent-kit-local-owner-membership', :'org_id', target_user.id, 'OWNER'::"Role"
FROM target_user
ON CONFLICT (org_id, user_id) DO UPDATE
SET role = 'OWNER'::"Role",
    updated_at = CURRENT_TIMESTAMP;

WITH target_user AS (
  SELECT id
  FROM users
  WHERE email = :'user_email'
),
target_org_membership AS (
  SELECT id
  FROM organization_memberships
  WHERE org_id = :'org_id'
    AND user_id = (SELECT id FROM target_user)
)
INSERT INTO project_memberships (project_id, user_id, org_membership_id, role)
SELECT :'project_id', target_user.id, target_org_membership.id, 'OWNER'::"Role"
FROM target_user, target_org_membership
ON CONFLICT (project_id, user_id) DO UPDATE
SET org_membership_id = EXCLUDED.org_membership_id,
    role = 'OWNER'::"Role",
    updated_at = CURRENT_TIMESTAMP;

CREATE TEMP TABLE expected_langfuse_local_key (
  public_key text NOT NULL,
  project_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO expected_langfuse_local_key (public_key, project_id)
VALUES (:'public_key', :'project_id');

DO $$
DECLARE
  expected_public_key text;
  expected_project_id text;
BEGIN
  SELECT public_key, project_id
  INTO expected_public_key, expected_project_id
  FROM expected_langfuse_local_key;

  IF expected_public_key IS NULL OR expected_project_id IS NULL THEN
    RAISE EXCEPTION 'Expected Langfuse local key context was not populated.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM api_keys
    WHERE public_key = expected_public_key
      AND project_id = expected_project_id
  ) THEN
    RAISE EXCEPTION 'Expected Langfuse local API key % for project % was not created by headless initialization. Recreate the Langfuse local volumes or align LANGFUSE_PUBLIC_KEY with the existing local key.', expected_public_key, expected_project_id;
  END IF;
END
$$;

COMMIT;
SQL

echo "Langfuse local bootstrap ready: ${user_email} / ${org_name} / ${project_name}"
