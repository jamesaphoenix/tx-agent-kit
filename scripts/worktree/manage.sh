#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SOURCE" ]; do
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  SCRIPT_SOURCE="$(readlink "$SCRIPT_SOURCE")"
  [[ "$SCRIPT_SOURCE" != /* ]] && SCRIPT_SOURCE="$SCRIPT_DIR/$SCRIPT_SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$SCRIPT_DIR/lib/colors.sh"
source "$SCRIPT_DIR/lib/validation.sh"
source "$SCRIPT_DIR/lib/ports.sh"

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/tx_agent_kit}"
PSQL_CONNECT_TIMEOUT="${PSQL_CONNECT_TIMEOUT:-3}"

if ! require_local_postgres_url "$DB_URL"; then
  exit 1
fi

show_help() {
  cat <<HELP
Usage: $0 <command> [options]

Commands:
  create <branch-name>         Create a git worktree
  list                         List worktrees + schema + deterministic ports
  setup <name>                 Run worktree schema/env setup
  verify <name>                Verify worktree path, env, and schema
  remove <name> [--yes]        Remove worktree and drop schema
  help                         Show this help
HELP
}

worktree_path_from_name() {
  local name="$1"
  echo "$ROOT_DIR/worktrees/$name"
}

schema_exists() {
  local schema="$1"
  local escaped_schema query output
  escaped_schema="${schema//\'/\'\'}"
  query="SELECT 1 FROM information_schema.schemata WHERE schema_name = '${escaped_schema}'"

  if ! output=$(PGCONNECT_TIMEOUT="$PSQL_CONNECT_TIMEOUT" psql "$DB_URL" -X -A -t -c "$query" 2>/dev/null); then
    return 2
  fi

  if echo "$output" | grep -q 1; then
    return 0
  fi

  return 1
}

collect_active_worktree_names() {
  git -C "$ROOT_DIR" worktree list --porcelain 2>/dev/null \
    | awk '/^worktree /{print $2}' \
    | while IFS= read -r worktree_path; do
      basename "$worktree_path"
    done
}

create_worktree() {
  local branch_name="${1:-}"
  if ! validate_name "$branch_name" "branch name"; then
    exit 1
  fi

  local worktree_path
  worktree_path="$(worktree_path_from_name "$branch_name")"

  if [[ -d "$worktree_path" ]]; then
    log_error "Worktree already exists at $worktree_path"
    exit 1
  fi

  mkdir -p "$ROOT_DIR/worktrees"

  cd "$ROOT_DIR"
  if ! git worktree add "$worktree_path" -b "$branch_name" 2>/dev/null; then
    git worktree add "$worktree_path" "$branch_name"
  fi

  log_success "Created worktree: worktrees/$branch_name"
  log_info "Port allocation:"
  mapfile -t active_worktree_names < <(collect_active_worktree_names)
  get_port_summary "$branch_name" "${active_worktree_names[@]}" | while IFS= read -r line; do
    printf '  %s\n' "$line"
  done

  printf '\n'
  log_info "Next steps:"
  printf '  1) %s setup %s\n' "$0" "$branch_name"
  printf '  2) cd worktrees/%s && pnpm db:migrate && pnpm dev\n' "$branch_name"
}

list_worktrees() {
  cd "$ROOT_DIR"
  mapfile -t active_worktree_names < <(collect_active_worktree_names)

  log_info "Active worktrees:"
  git worktree list | while IFS= read -r line; do
    local path branch name schema

    path=$(echo "$line" | awk '{print $1}')
    branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

    if [[ "$path" == "$ROOT_DIR" ]]; then
      continue
    fi

    name=$(basename "$path")
    schema=$(generate_schema_name "$name")

    printf '\n%s%s%s\n' "$GREEN" "$name" "$NC"
    printf '  Path: %s\n' "$path"
    printf '  Branch: %s\n' "$branch"
    printf '  Schema: %s\n' "$schema"

    if schema_exists "$schema"; then
      printf '  Schema status: %sready%s\n' "$GREEN" "$NC"
    else
      case $? in
        1)
          printf '  Schema status: %smissing%s\n' "$YELLOW" "$NC"
          ;;
        2)
          printf '  Schema status: %sdb unreachable%s\n' "$RED" "$NC"
          ;;
      esac
    fi

    get_port_summary "$name" "${active_worktree_names[@]}" | while IFS= read -r summary; do
      printf '  %s\n' "$summary"
    done
  done
}

setup_worktree() {
  local name="${1:-}"
  if ! validate_name "$name" "worktree name"; then
    exit 1
  fi

  "$SCRIPT_DIR/setup.sh" "$(worktree_path_from_name "$name")"
}

verify_worktree() {
  local name="${1:-}"
  if ! validate_name "$name" "worktree name"; then
    exit 1
  fi

  local path schema env_file
  path="$(worktree_path_from_name "$name")"
  schema=$(generate_schema_name "$name")
  env_file="$path/.env"

  if [[ ! -d "$path" ]]; then
    log_error "Worktree path missing: $path"
    exit 1
  fi

  log_success "Worktree path exists: $path"

  if [[ -f "$env_file" ]]; then
    log_success "Env file exists: $env_file"
  else
    log_warn "Env file missing: $env_file"
  fi

  if schema_exists "$schema"; then
    log_success "Schema exists: $schema"
  else
    case $? in
      1)
        log_warn "Schema missing: $schema"
        ;;
      2)
        log_error "Database unreachable for schema verification. Check DATABASE_URL and local postgres."
        exit 1
        ;;
    esac
  fi
}

remove_worktree() {
  local name="${1:-}"
  local confirmation="${2:-}"

  if ! validate_name "$name" "worktree name"; then
    exit 1
  fi

  local path schema
  path="$(worktree_path_from_name "$name")"
  schema=$(generate_schema_name "$name")

  if [[ ! -d "$path" ]]; then
    log_error "Worktree not found: $path"
    exit 1
  fi

  if [[ "$confirmation" != "--yes" ]]; then
    log_warn "This will remove worktree '$name' and drop schema '$schema'."
    read -r -p "Continue? [y/N] " answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
      log_info "Cancelled"
      exit 0
    fi
  fi

  cd "$ROOT_DIR"
  git worktree remove "$path" --force || true
  rm -rf "$path"

  local quoted_schema
  quoted_schema=$(quote_identifier "$schema")
  if ! psql "$DB_URL" -c "DROP SCHEMA IF EXISTS $quoted_schema CASCADE;" >/dev/null 2>&1; then
    log_warn "Failed to drop schema '$schema' (database may be unreachable)."
  fi

  log_success "Removed worktree '$name' and schema '$schema'."
}

main() {
  local command="${1:-help}"
  shift || true

  case "$command" in
    create)
      create_worktree "$@"
      ;;
    list)
      list_worktrees
      ;;
    setup)
      setup_worktree "$@"
      ;;
    verify)
      verify_worktree "$@"
      ;;
    remove)
      remove_worktree "$@"
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      log_error "Unknown command: $command"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
