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

echo "Enabling required GCP APIs for project: $GCP_PROJECT_ID"
gcloud services enable \
  cloudtrace.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  iam.googleapis.com \
  serviceusage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project "$GCP_PROJECT_ID"

echo "GCP APIs enabled for $GCP_PROJECT_ID"
