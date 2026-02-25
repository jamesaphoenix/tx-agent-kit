#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

require_guard
require_tool gcloud

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [project-id]"
  exit 1
fi

if [[ $# -eq 1 ]]; then
  GCP_PROJECT_ID="$1"
fi
require_env GCP_PROJECT_ID

SA_NAME="${OTEL_COLLECTOR_SA_NAME:-otel-collector}"
SA_DISPLAY_NAME="${OTEL_COLLECTOR_SA_DISPLAY_NAME:-tx-agent-kit OTEL Collector}"
SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
GENERATE_SA_KEY="${GENERATE_OTEL_SA_KEY:-1}"
SA_KEY_FILE="${OTEL_COLLECTOR_KEY_FILE:-$GCP_RENDERED_DIR/${GCP_PROJECT_ID}-${SA_NAME}.json}"

if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" \
    --project "$GCP_PROJECT_ID" \
    --display-name "$SA_DISPLAY_NAME"
fi

roles=(
  "roles/cloudtrace.agent"
  "roles/logging.logWriter"
  "roles/monitoring.metricWriter"
)

for role in "${roles[@]}"; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" \
    --role "$role" \
    --quiet >/dev/null
done

if [[ "$GENERATE_SA_KEY" == "1" ]]; then
  mkdir -p "$(dirname "$SA_KEY_FILE")"

  if [[ ! -f "$SA_KEY_FILE" ]]; then
    gcloud iam service-accounts keys create "$SA_KEY_FILE" \
      --iam-account "$SA_EMAIL" \
      --project "$GCP_PROJECT_ID"
  fi

  chmod 600 "$SA_KEY_FILE"
fi

echo "OTEL collector service account ready: $SA_EMAIL"
if [[ "$GENERATE_SA_KEY" == "1" ]]; then
  echo "OTEL collector key file: $SA_KEY_FILE"
fi
