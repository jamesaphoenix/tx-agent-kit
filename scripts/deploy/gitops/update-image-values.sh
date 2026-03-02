#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <mac-staging|mac-prod|gke-staging|gke-prod> <images-env-file>"
  exit 1
fi

environment="$1"
artifact_file="$2"

case "$environment" in
  mac-staging|mac-prod|gke-staging|gke-prod)
    ;;
  *)
    echo "Invalid environment '$environment'."
    exit 1
    ;;
esac

if [[ ! -f "$artifact_file" ]]; then
  echo "Artifact file not found: $artifact_file"
  exit 1
fi

values_file="$PROJECT_ROOT/deploy/gitops/environments/${environment}/images.values.yaml"
if [[ ! -f "$values_file" ]]; then
  echo "Missing GitOps values file: $values_file"
  exit 1
fi

api_image=""
worker_image=""
while IFS='=' read -r key value; do
  case "$key" in
    API_IMAGE)
      api_image="$value"
      ;;
    WORKER_IMAGE)
      worker_image="$value"
      ;;
  esac
done < <("$PROJECT_ROOT/scripts/deploy/ci/load-image-artifact.sh" "$artifact_file")

if [[ -z "$api_image" || -z "$worker_image" ]]; then
  echo "Unable to resolve API_IMAGE/WORKER_IMAGE from artifact: $artifact_file"
  exit 1
fi

image_ref_pattern='^[a-zA-Z0-9._/-]+:[a-zA-Z0-9._-]+$'
if [[ ! "$api_image" =~ $image_ref_pattern ]]; then
  echo "Invalid API_IMAGE format: $api_image"
  exit 1
fi
if [[ ! "$worker_image" =~ $image_ref_pattern ]]; then
  echo "Invalid WORKER_IMAGE format: $worker_image"
  exit 1
fi

cat > "$values_file" <<YAML
images:
  api: "${api_image}"
  worker: "${worker_image}"
YAML

echo "Updated $values_file"
