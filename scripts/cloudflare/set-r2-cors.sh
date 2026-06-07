#!/usr/bin/env bash
#
# Apply CORS rules to the R2 buckets so the web app can upload media directly to
# a presigned R2 URL from the browser.
#
# Why this exists: the media library requests a presigned PUT URL from the API
# and then PUTs the file straight to `<account>.r2.cloudflarestorage.com`. R2
# buckets reject cross-origin browser requests unless a CORS policy lists the
# app origin, without it the upload fails with "Failed to fetch".
#
# This script is idempotent: a PUT replaces the bucket's entire CORS config, so
# re-running simply re-asserts the desired state. Safe to run any time the
# origins change.
#
# Credentials come from 1Password (op://api-keys/Cloudflare). The Global API Key
# is used because R2 bucket CORS is an account-level operation.
#
# Usage:
#   scripts/cloudflare/set-r2-cors.sh            # all buckets
#   scripts/cloudflare/set-r2-cors.sh staging    # one environment (dev|staging|prod)
set -euo pipefail

ACCOUNT_ID="$(op read 'op://api-keys/Cloudflare/account_id')"
AUTH_EMAIL="$(op read 'op://api-keys/Cloudflare/auth_email')"
AUTH_KEY="$(op read 'op://api-keys/Cloudflare/global_api_key')"

API="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets"

# bucket -> space-separated allowed origins
origins_for() {
  case "$1" in
    # Allow any origin in dev: worktrees run web clients on many localhost
    # ports and R2 does not support partial wildcards like "http://localhost:*"
    # (only exact origins or "*"). Local-only, presigned URLs are
    # self-authorizing, so "*" is acceptable here. NEVER use "*" for staging/prod.
    tx-agent-kit-dev)     echo "*" ;;
    # TODO: replace with this repo's real staging web origin once the domain is
    # provisioned. The domain is not committed to the repo (it lives in
    # 1Password as API_CORS_ORIGIN/WEB_BASE_URL). NEVER use "*" for staging.
    tx-agent-kit-staging) echo "https://staging.<domain>" ;;
    # TODO: replace with this repo's real prod web origin(s) once the domain is
    # provisioned. The domain is not committed to the repo (it lives in
    # 1Password as API_CORS_ORIGIN/WEB_BASE_URL). NEVER use "*" for prod.
    tx-agent-kit-prod)    echo "https://<domain> https://www.<domain>" ;;
    *) echo "" ;;
  esac
}

apply_cors() {
  local bucket="$1"
  local origins_str origins_json
  origins_str="$(origins_for "$bucket")"
  origins_json="$(python3 -c 'import sys,json; print(json.dumps(sys.argv[1].split()))' "$origins_str")"

  # GET/PUT/HEAD covers presigned uploads (PUT) and any direct asset/thumbnail
  # reads (GET/HEAD). Content-Type is the only header the browser PUT sets.
  local body
  body="$(python3 -c "import json,sys; print(json.dumps({'rules':[{'allowed':{'origins':json.loads(sys.argv[1]),'methods':['GET','PUT','HEAD'],'headers':['content-type']},'exposeHeaders':['ETag'],'maxAgeSeconds':3600}]}))" "$origins_json")"

  echo "==> $bucket  origins=$origins_json"
  # No -f: let the JSON error body through so failures print cleanly rather than
  # aborting on an empty response.
  curl -s -X PUT \
    -H "X-Auth-Email: ${AUTH_EMAIL}" \
    -H "X-Auth-Key: ${AUTH_KEY}" \
    -H "Content-Type: application/json" \
    --data "$body" \
    "${API}/${bucket}/cors" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("    success:", d.get("success"), "errors:", d.get("errors")); sys.exit(0 if d.get("success") else 1)'
}

case "${1:-all}" in
  dev)     apply_cors tx-agent-kit-dev ;;
  staging) apply_cors tx-agent-kit-staging ;;
  prod)    apply_cors tx-agent-kit-prod ;;
  all)
    apply_cors tx-agent-kit-dev
    apply_cors tx-agent-kit-staging
    apply_cors tx-agent-kit-prod
    ;;
  *) echo "Unknown environment: ${1}. Use dev|staging|prod|all." >&2; exit 1 ;;
esac

echo "Done."
