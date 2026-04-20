#!/usr/bin/env bash
# Idempotent dev account seeder.
# Creates a dev user + org + workspace if they don't already exist.
# Safe to run on every `pnpm dev` — skips if the account is already present.

set -euo pipefail

API_URL="${API_BASE_URL:-http://localhost:4000}"
DEV_EMAIL="dev@tx-agent-kit.local"
DEV_PASSWORD="dev-password-12345"
DEV_NAME="Dev User"
DEV_ORG_NAME="Dev Organization"
DEV_WORKSPACE_NAME="Dev Workspace"

echo "[seed] Checking for dev account (${DEV_EMAIL})..."

# Try to sign in first — if it works, the account already exists
SIGN_IN_RESPONSE=$(curl -sf -X POST "${API_URL}/v1/auth/sign-in" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${DEV_EMAIL}\",\"password\":\"${DEV_PASSWORD}\"}" 2>/dev/null || echo "FAIL")

if [[ "$SIGN_IN_RESPONSE" == "FAIL" ]]; then
  echo "[seed] Dev account not found. Creating..."
  SIGN_UP_RESPONSE=$(curl -sf -X POST "${API_URL}/v1/auth/sign-up" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${DEV_NAME}\",\"email\":\"${DEV_EMAIL}\",\"password\":\"${DEV_PASSWORD}\"}" 2>/dev/null || echo "FAIL")

  if [[ "$SIGN_UP_RESPONSE" == "FAIL" ]]; then
    echo "[seed] WARNING: Could not create dev account. API may not be ready yet."
    exit 0
  fi

  TOKEN=$(echo "$SIGN_UP_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
  echo "[seed] Dev account created."
else
  TOKEN=$(echo "$SIGN_IN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
  echo "[seed] Dev account already exists."
fi

if [[ -z "$TOKEN" ]]; then
  echo "[seed] WARNING: Could not obtain auth token. Skipping org/workspace creation."
  exit 0
fi

# Check if the dev org already exists
ORGS_RESPONSE=$(curl -sf -X GET "${API_URL}/v1/organizations?limit=100" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "FAIL")

if [[ "$ORGS_RESPONSE" != "FAIL" ]]; then
  HAS_DEV_ORG=$(echo "$ORGS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
orgs = data.get('data', data) if isinstance(data, dict) else data
print('yes' if any(o.get('name') == '${DEV_ORG_NAME}' for o in (orgs if isinstance(orgs, list) else [])) else 'no')
" 2>/dev/null || echo "no")

  if [[ "$HAS_DEV_ORG" == "no" ]]; then
    echo "[seed] Creating dev organization..."
    ORG_RESPONSE=$(curl -sf -X POST "${API_URL}/v1/organizations" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"name\":\"${DEV_ORG_NAME}\"}" 2>/dev/null || echo "FAIL")

    if [[ "$ORG_RESPONSE" != "FAIL" ]]; then
      ORG_ID=$(echo "$ORG_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
      echo "[seed] Dev organization created (${ORG_ID})."

      if [[ -n "$ORG_ID" ]]; then
        echo "[seed] Creating dev workspace..."
        curl -sf -X POST "${API_URL}/v1/teams" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -d "{\"organizationId\":\"${ORG_ID}\",\"name\":\"${DEV_WORKSPACE_NAME}\"}" >/dev/null 2>&1 || true
        echo "[seed] Dev workspace created."
      fi
    fi
  else
    echo "[seed] Dev organization already exists."
  fi
fi

echo "[seed] Done. Sign in with: ${DEV_EMAIL} / ${DEV_PASSWORD}"
