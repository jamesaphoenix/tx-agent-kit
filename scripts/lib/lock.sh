#!/usr/bin/env bash

set -euo pipefail

get_file_mtime_epoch() {
  local path="$1"

  if mtime="$(stat -f %m "$path" 2>/dev/null)"; then
    printf '%s\n' "$mtime"
    return 0
  fi

  if mtime="$(stat -c %Y "$path" 2>/dev/null)"; then
    printf '%s\n' "$mtime"
    return 0
  fi

  return 1
}

lock_try_reap_stale() {
  local lock_dir="$1"
  local stale_after_seconds="${2:-900}"
  local missing_pid_grace_seconds="${3:-15}"
  local pid_file="$lock_dir/pid"

  if [[ -f "$pid_file" ]]; then
    local lock_pid=''
    lock_pid="$(cat "$pid_file" 2>/dev/null || true)"

    if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
      rm -rf "$lock_dir"
      return 0
    fi

    return 1
  fi

  local now
  now="$(date +%s)"
  local mtime
  if ! mtime="$(get_file_mtime_epoch "$lock_dir")"; then
    return 1
  fi

  local effective_missing_pid_grace_seconds="$missing_pid_grace_seconds"
  if (( effective_missing_pid_grace_seconds > stale_after_seconds )); then
    effective_missing_pid_grace_seconds="$stale_after_seconds"
  fi

  local age=$((now - mtime))
  if (( age >= effective_missing_pid_grace_seconds )); then
    rm -rf "$lock_dir"
    return 0
  fi

  return 1
}

lock_acquire() {
  local lock_dir="$1"
  local timeout_seconds="${2:-900}"
  local missing_pid_grace_seconds="${3:-15}"
  local waited=0

  while ! mkdir "$lock_dir" 2>/dev/null; do
    lock_try_reap_stale "$lock_dir" "$timeout_seconds" "$missing_pid_grace_seconds" || true

    if (( waited >= timeout_seconds )); then
      echo "Timed out waiting for lock: $lock_dir"
      return 1
    fi

    sleep 1
    waited=$((waited + 1))
  done

  printf '%s\n' "$$" > "$lock_dir/pid"
}

lock_release() {
  local lock_dir="$1"

  rm -f "$lock_dir/pid" 2>/dev/null || true
  rmdir "$lock_dir" 2>/dev/null || true
}
