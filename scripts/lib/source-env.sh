#!/usr/bin/env bash
set -euo pipefail

# Source a .env file into the current shell with set -a semantics, resolving
# 1Password op:// references on the fly when the op CLI is available.

# 1Password read budget: every `op://` reference costs one read against the
# service account's shared limit (1000 per rolling 24h across every agent and
# job). This helper runs on every dev/test entrypoint, so resolving fresh each
# time exhausted the limit on 18 Oct 2026. The resolved file is cached outside
# the repo, keyed by a hash of the .env content, so editing .env re-resolves:
#   TX_SOURCE_ENV_CACHE_DIR          default ${XDG_CACHE_HOME:-$HOME/.cache}/txak-source-env
#   TX_SOURCE_ENV_CACHE_TTL_SECONDS  default 28800 (8h); 0 disables the cache
#   TX_SOURCE_ENV_NO_CACHE=1         resolve fresh (e.g. after rotating a secret)
# The directory is mode 700 and each file mode 600.

# Tunnel-mode support: every source_env call re-applies the overlay env file
# AFTER the requested file. Without this, per-app dev scripts that re-source
# .env (apps/api, apps/web, ...) would clobber the overlay values - turbo's
# strict env mode strips ad-hoc vars from task environments, so the overlay must
# be rediscovered on each source. The overlay is discovered from (in order):
#   1. TX_DEV_ENV_OVERLAY - explicit, for ad-hoc shells
#   2. .data/dev-env-overlay next to the sourced env file - written by
#      `scripts/dev.sh --tunnel`, survives turbo strict env mode.
source_env() {
  local env_file="${1:-}"

  __source_env_one "$env_file"

  local overlay="${TX_DEV_ENV_OVERLAY:-}"
  if [[ -z "$overlay" && -n "$env_file" && -f "$env_file" ]]; then
    # Resolve to an absolute path first: per-app dev scripts pass relative
    # paths like ../../.env, and the marker must be found regardless of the
    # caller's working directory (and never found in worktrees, which have
    # their own checkout root without a marker).
    local env_dir marker
    env_dir="$(cd "$(dirname "$env_file")" 2>/dev/null && pwd)"
    if [[ -n "$env_dir" ]]; then
      marker="${env_dir}/.data/dev-env-overlay"
      if [[ -f "$marker" ]]; then
        overlay="$(head -n 1 "$marker")"
      fi
    fi
  fi

  if [[ -n "$overlay" && -f "$overlay" && "$overlay" != "$env_file" ]]; then
    __source_env_one "$overlay"
  fi
}

__source_env_one() {
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

  local cache_file=""
  cache_file="$(__source_env_cache_file "$env_file")"
  if [[ -n "$cache_file" && -f "$cache_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$cache_file"
    set +a
    return 0
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

  # Only a successful inject is cached. mv within the cache dir is atomic, so
  # a concurrent reader never sees a half-written file.
  if [[ -n "$cache_file" ]]; then
    local staged
    staged="$(mktemp "$(dirname "$cache_file")/.staging.XXXXXX" 2>/dev/null)" &&
      chmod 600 "$staged" &&
      cat "$resolved" >"$staged" &&
      mv -f "$staged" "$cache_file" || rm -f "${staged:-}" >/dev/null 2>&1 || true
  fi

  rm -f "$resolved" >/dev/null 2>&1 || true
}

# Prints the cache path for an env file, or nothing when caching is disabled
# or unavailable. Expired entries are removed here, so a hit is always fresh.
__source_env_cache_file() {
  local env_file="$1"
  local ttl="${TX_SOURCE_ENV_CACHE_TTL_SECONDS:-28800}"

  if [[ "${TX_SOURCE_ENV_NO_CACHE:-0}" == "1" || ! "$ttl" =~ ^[0-9]+$ || "$ttl" -eq 0 ]]; then
    return 0
  fi

  local dir="${TX_SOURCE_ENV_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/txak-source-env}"
  (umask 077 && mkdir -p "$dir") >/dev/null 2>&1 || return 0
  chmod 700 "$dir" >/dev/null 2>&1 || return 0

  # `|| true`: callers source this file under `set -euo pipefail`.
  local digest
  digest="$( (shasum -a 256 "$env_file" 2>/dev/null || sha256sum "$env_file" 2>/dev/null) | cut -c1-64)" || true
  [[ -n "$digest" ]] || return 0

  local file="$dir/$digest.env"
  if [[ -f "$file" ]]; then
    local mtime now
    mtime="$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    if (( now - mtime >= ttl )); then
      rm -f "$file" >/dev/null 2>&1 || true
    fi
  fi

  printf '%s\n' "$file"
}

# Decide whether a local .env should be sourced. In CI the environment is
# provided by the workflow directly, and a committed/op:// .env would fail the
# strict resolver (op is not on PATH on the runner), so skip it unless explicitly
# opted in via TX_SOURCE_ENV_IN_CI=1.
should_source_env_file() {
  local env_file="${1:-}"

  if [[ -z "$env_file" || ! -f "$env_file" ]]; then
    return 1
  fi

  if [[ "${CI:-}" == "true" && "${TX_SOURCE_ENV_IN_CI:-0}" != "1" ]]; then
    echo "source-env: skipping local .env sourcing in CI (set TX_SOURCE_ENV_IN_CI=1 to opt in)." >&2
    return 1
  fi

  return 0
}

# CI-safe wrapper: source the env file locally, no-op in CI.
source_env_if_allowed() {
  local env_file="${1:-}"

  if should_source_env_file "$env_file"; then
    source_env "$env_file"
  fi
}
