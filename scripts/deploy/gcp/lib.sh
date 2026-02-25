#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GCP_RENDERED_DIR="${GCP_RENDERED_DIR:-$PROJECT_ROOT/deploy/.rendered/gcp}"
mkdir -p "$GCP_RENDERED_DIR"

require_guard() {
  if [[ "${RUN_GCP_E2E:-0}" != "1" ]]; then
    echo "Refusing to run GCP E2E workflow without RUN_GCP_E2E=1"
    exit 1
  fi
}

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool"
    exit 1
  fi
}

require_env() {
  local env_name="$1"
  if [[ -z "${!env_name:-}" ]]; then
    echo "Missing required environment variable: $env_name"
    exit 1
  fi
}

random_suffix() {
  printf '%04x%04x' "$RANDOM" "$RANDOM"
}

resolve_toy_project_id() {
  if [[ -n "${GCP_TOY_PROJECT_ID:-}" ]]; then
    printf '%s' "$GCP_TOY_PROJECT_ID"
    return
  fi

  local suffix
  suffix="$(random_suffix)"
  printf 'txak-otel-%s' "$suffix"
}

write_toy_project_env() {
  local project_id="$1"
  local sa_email="$2"
  local key_file="$3"
  local out_file="$GCP_RENDERED_DIR/toy-project.env"

  cat > "$out_file" <<ENVFILE
GCP_PROJECT_ID=$project_id
OTEL_COLLECTOR_SERVICE_ACCOUNT_EMAIL=$sa_email
OTEL_COLLECTOR_KEY_FILE=$key_file
ENVFILE

  echo "$out_file"
}
