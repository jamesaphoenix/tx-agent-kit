#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd"
    exit 1
  fi
}

require_cmd docker

if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is required"
  exit 1
fi

infer_repository() {
  local origin_url
  origin_url="$(git config --get remote.origin.url 2>/dev/null || true)"

  if [[ "$origin_url" =~ github.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]'
    return
  fi

  echo "jamesaphoenix/tx-agent-kit"
}

IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}"
IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/amd64}"
PUSH_IMAGES="${PUSH_IMAGES:-0}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-$(infer_repository)}"
API_IMAGE_REPO="${API_IMAGE_REPO:-${IMAGE_REGISTRY}/${IMAGE_REPOSITORY}/api}"
WORKER_IMAGE_REPO="${WORKER_IMAGE_REPO:-${IMAGE_REGISTRY}/${IMAGE_REPOSITORY}/worker}"

BUILD_OUTPUT_FLAG="--load"
if [[ "$PUSH_IMAGES" == "1" ]]; then
  BUILD_OUTPUT_FLAG="--push"
fi

build_image() {
  local image_repo="$1"
  local dockerfile_path="$2"

  docker buildx build \
    --platform "$IMAGE_PLATFORM" \
    "$BUILD_OUTPUT_FLAG" \
    -t "$image_repo:$IMAGE_TAG" \
    -f "$dockerfile_path" \
    .
}

resolve_pinned_image() {
  local image_repo="$1"
  if [[ "$PUSH_IMAGES" != "1" ]]; then
    echo "$image_repo:$IMAGE_TAG"
    return
  fi

  local digest
  digest="$(docker buildx imagetools inspect "$image_repo:$IMAGE_TAG" --format '{{json .Manifest.Digest}}' | tr -d '"')"

  if [[ -z "$digest" ]]; then
    echo "Failed to resolve digest for $image_repo:$IMAGE_TAG"
    exit 1
  fi

  echo "$image_repo@$digest"
}

echo "Building API image: $API_IMAGE_REPO:$IMAGE_TAG"
build_image "$API_IMAGE_REPO" "apps/api/Dockerfile"

echo "Building worker image: $WORKER_IMAGE_REPO:$IMAGE_TAG"
build_image "$WORKER_IMAGE_REPO" "apps/worker/Dockerfile"

API_IMAGE="$(resolve_pinned_image "$API_IMAGE_REPO")"
WORKER_IMAGE="$(resolve_pinned_image "$WORKER_IMAGE_REPO")"

ARTIFACT_DIR="${DEPLOY_ARTIFACT_DIR:-deploy/artifacts}"
mkdir -p "$ARTIFACT_DIR"
ARTIFACT_FILE="$ARTIFACT_DIR/images-${IMAGE_TAG}.env"

cat > "$ARTIFACT_FILE" <<ARTIFACT
IMAGE_TAG=$IMAGE_TAG
API_IMAGE=$API_IMAGE
WORKER_IMAGE=$WORKER_IMAGE
ARTIFACT

echo "Wrote deployment image artifact: $ARTIFACT_FILE"
echo "API_IMAGE=$API_IMAGE"
echo "WORKER_IMAGE=$WORKER_IMAGE"
