#!/usr/bin/env bash
set -euo pipefail

# Source a .env file into the current shell with set -a semantics, resolving
# 1Password op:// references on the fly when the op CLI is available.

source_env() {
  local env_file="${1:-}"

  if [[ -z "$env_file" || ! -f "$env_file" ]]; then
    return 0
  fi

  if ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=op://' "$env_file"; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    return 0
  fi

  if [[ "${SOURCE_ENV_ALLOW_LITERAL_OP:-}" == "1" ]]; then
    echo "source-env: $env_file contains op:// references; SOURCE_ENV_ALLOW_LITERAL_OP=1 so sourcing literal values." >&2
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    return 0
  fi

  if ! command -v op >/dev/null 2>&1; then
    echo "source-env: $env_file contains op:// references but op is not on PATH." >&2
    echo "source-env: install/sign in to 1Password CLI, or set SOURCE_ENV_ALLOW_LITERAL_OP=1 for an explicit literal fallback." >&2
    return 1
  fi

  local resolved
  resolved="$(mktemp -t txak-env.XXXXXX)" || {
    echo "source-env: failed to create tempfile for op injection." >&2
    return 1
  }

  trap 'rm -f "'"$resolved"'" >/dev/null 2>&1 || true' EXIT

  local op_err=""
  local op_status=0
  op_err="$(op inject -i "$env_file" -o "$resolved" -f 2>&1 >/dev/null)" || op_status=$?
  if [[ "$op_status" -ne 0 ]]; then
    echo "source-env: op inject failed for $env_file (${op_err:-no stderr})." >&2
    echo "source-env: resolve the 1Password reference or set SOURCE_ENV_ALLOW_LITERAL_OP=1 for an explicit literal fallback." >&2
    rm -f "$resolved" >/dev/null 2>&1 || true
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$resolved"
  set +a

  rm -f "$resolved" >/dev/null 2>&1 || true
}
