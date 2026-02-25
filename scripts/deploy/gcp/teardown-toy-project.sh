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
elif [[ -z "${GCP_PROJECT_ID:-}" && -f "$GCP_RENDERED_DIR/toy-project.env" ]]; then
  # shellcheck disable=SC1090
  source "$GCP_RENDERED_DIR/toy-project.env"
fi

require_env GCP_PROJECT_ID

echo "Scheduling deletion for toy GCP project: $GCP_PROJECT_ID"
gcloud projects delete "$GCP_PROJECT_ID" --quiet

echo "Project deletion requested: $GCP_PROJECT_ID"
