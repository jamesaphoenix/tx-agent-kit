#!/usr/bin/env bash
set -euo pipefail

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_LIB_DIR/colors.sh"

validate_name() {
  local name="$1"
  local label="${2:-name}"

  if [[ -z "$name" ]]; then
    log_error "${label} cannot be empty"
    return 1
  fi

  if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    log_error "Invalid ${label}: '$name' (allowed: letters, numbers, -, _)"
    return 1
  fi

  if [[ "$name" =~ ^[0-9] ]]; then
    log_error "Invalid ${label}: '$name' (must not start with number)"
    return 1
  fi

  return 0
}

extract_postgres_host() {
  local database_url="$1"
  local without_protocol remainder host_port host

  without_protocol="${database_url#postgresql://}"
  without_protocol="${without_protocol#postgres://}"
  remainder="${without_protocol#*@}"
  host_port="${remainder%%/*}"
  host="${host_port%%:*}"
  host="${host#[}"
  host="${host%]}"
  printf '%s\n' "$host"
}

extract_postgres_db_name() {
  local database_url="$1"
  local without_query path

  without_query="${database_url%%\?*}"
  path="${without_query##*/}"
  printf '%s\n' "$path"
}

is_local_postgres_url() {
  local database_url="$1"
  local host

  if [[ ! "$database_url" =~ ^postgres(ql)?:// ]]; then
    return 1
  fi

  host="$(extract_postgres_host "$database_url")"

  [[ "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "::1" ]]
}

require_local_postgres_url() {
  local database_url="$1"
  local db_name

  if ! is_local_postgres_url "$database_url"; then
    log_error "Unsafe DATABASE_URL for worktree tooling. Only local postgres hosts are allowed: $database_url"
    return 1
  fi

  db_name="$(extract_postgres_db_name "$database_url")"
  if [[ "$db_name" != "tx_agent_kit" ]]; then
    log_error "Unsafe DATABASE_URL database for worktree tooling. Expected database name 'tx_agent_kit', got '$db_name'."
    return 1
  fi

  return 0
}

generate_schema_name() {
  local worktree_name="$1"
  local raw="wt_$(echo "$worktree_name" | tr '-' '_' | tr '[:upper:]' '[:lower:]')"
  echo "${raw:0:63}"
}

quote_identifier() {
  local identifier="$1"
  local escaped="${identifier//\"/\"\"}"
  echo "\"$escaped\""
}
