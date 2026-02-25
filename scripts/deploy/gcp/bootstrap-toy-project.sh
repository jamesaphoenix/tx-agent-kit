#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

require_guard
require_tool gcloud

require_env GCP_BILLING_ACCOUNT_ID

GCP_PROJECT_ID="$(resolve_toy_project_id)"
GCP_PROJECT_NAME="${GCP_TOY_PROJECT_NAME:-tx-agent-kit otel e2e}"
GCP_PROJECT_PARENT="${GCP_TOY_PROJECT_PARENT:-}"

if ! gcloud projects describe "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  create_args=(
    "$GCP_PROJECT_ID"
    "--name=$GCP_PROJECT_NAME"
  )

  if [[ -n "$GCP_PROJECT_PARENT" ]]; then
    if [[ "$GCP_PROJECT_PARENT" == organizations/* ]]; then
      create_args+=("--organization=${GCP_PROJECT_PARENT#organizations/}")
    elif [[ "$GCP_PROJECT_PARENT" == folders/* ]]; then
      create_args+=("--folder=${GCP_PROJECT_PARENT#folders/}")
    else
      echo "Invalid GCP_TOY_PROJECT_PARENT. Expected organizations/<id> or folders/<id>."
      exit 1
    fi
  fi

  echo "Creating toy GCP project: $GCP_PROJECT_ID"
  gcloud projects create "${create_args[@]}"
fi

echo "Linking billing account to $GCP_PROJECT_ID"
gcloud beta billing projects link "$GCP_PROJECT_ID" \
  --billing-account "$GCP_BILLING_ACCOUNT_ID" \
  --quiet

RUN_GCP_E2E=1 GCP_PROJECT_ID="$GCP_PROJECT_ID" "$SCRIPT_DIR/enable-apis.sh"
RUN_GCP_E2E=1 GCP_PROJECT_ID="$GCP_PROJECT_ID" "$SCRIPT_DIR/create-otel-sa.sh"

SA_NAME="${OTEL_COLLECTOR_SA_NAME:-otel-collector}"
SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
SA_KEY_FILE="${OTEL_COLLECTOR_KEY_FILE:-$GCP_RENDERED_DIR/${GCP_PROJECT_ID}-${SA_NAME}.json}"
TOY_ENV_FILE="$(write_toy_project_env "$GCP_PROJECT_ID" "$SA_EMAIL" "$SA_KEY_FILE")"

echo "Toy project bootstrap complete."
echo "Project: $GCP_PROJECT_ID"
echo "Metadata: $TOY_ENV_FILE"
