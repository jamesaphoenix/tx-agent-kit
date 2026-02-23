#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <staging|prod>"
  exit 1
fi

TARGET_ENV="$1"
if [[ "$TARGET_ENV" != "staging" && "$TARGET_ENV" != "prod" ]]; then
  echo "Invalid environment '$TARGET_ENV'. Expected 'staging' or 'prod'."
  exit 1
fi

if ! command -v op >/dev/null 2>&1; then
  echo "1Password CLI (op) is required"
  exit 1
fi

TEMPLATE_FILE="deploy/env/${TARGET_ENV}.env.template"
if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Missing env template: $TEMPLATE_FILE"
  exit 1
fi

RENDERED_ENV_FILE="$(mktemp -t tx-agent-kit-${TARGET_ENV}-migrate-env.XXXXXX)"
trap 'rm -f "$RENDERED_ENV_FILE"' EXIT

op inject -i "$TEMPLATE_FILE" -o "$RENDERED_ENV_FILE" >/dev/null

set -a
# shellcheck disable=SC1090
source "$RENDERED_ENV_FILE"
set +a

echo "Running DB migrations for $TARGET_ENV"
pnpm --filter @tx-agent-kit/db db:migrate
