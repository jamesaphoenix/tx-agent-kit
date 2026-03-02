#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <images-env-file>"
  exit 1
fi

ARTIFACT_FILE="$1"

if [[ ! -f "$ARTIFACT_FILE" ]]; then
  echo "Artifact file not found: $ARTIFACT_FILE"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/load-image-artifact.sh" "$ARTIFACT_FILE" >/dev/null

echo "Artifact validated: $ARTIFACT_FILE"
