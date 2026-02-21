#!/usr/bin/env bash
# Context-efficient command runner: quiet on success, verbose on failure.

set -euo pipefail

if [[ -t 1 ]] && [[ -z "${CI:-}" ]]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  GRAY='\033[0;90m'
  NC='\033[0m'
else
  GREEN=''
  RED=''
  YELLOW=''
  GRAY=''
  NC=''
fi

format_duration() {
  local seconds="$1"
  local int_seconds=${seconds%.*}
  local decimal=${seconds#*.}

  if [[ "$int_seconds" -lt 60 ]]; then
    printf "%s.%ss" "$int_seconds" "${decimal:0:1}"
  else
    local mins=$((int_seconds / 60))
    local secs=$((int_seconds % 60))
    printf "%dm %ds" "$mins" "$secs"
  fi
}

extract_summary() {
  local output_file="$1"
  local summary

  summary=$(grep -E "^\s*(Tests?|Test Files?)\s+[0-9]+" "$output_file" 2>/dev/null | tail -2 | tr '\n' ' ' | sed 's/  */ /g' | xargs)
  if [[ -z "$summary" ]]; then
    summary=$(grep -E "Tasks:\s+[0-9]+" "$output_file" 2>/dev/null | tail -1 | xargs)
  fi

  echo "$summary"
}

run_silent() {
  local description="$1"
  local command="$2"
  local tmp_file
  tmp_file=$(mktemp)

  local start_time
  start_time=$(date +%s.%N 2>/dev/null || date +%s)

  if (eval "$command") >"$tmp_file" 2>&1; then
    local end_time
    end_time=$(date +%s.%N 2>/dev/null || date +%s)
    local duration
    duration=$(awk "BEGIN {printf \"%.1f\", $end_time - $start_time}" 2>/dev/null || echo "0")
    local formatted_duration
    formatted_duration=$(format_duration "$duration")
    local summary
    summary=$(extract_summary "$tmp_file")

    if [[ -n "$summary" ]]; then
      printf "  ${GREEN}OK${NC} %s ${GRAY}(%s)${NC} ${YELLOW}[%s]${NC}\n" "$description" "$summary" "$formatted_duration"
    else
      printf "  ${GREEN}OK${NC} %s ${YELLOW}[%s]${NC}\n" "$description" "$formatted_duration"
    fi

    rm -f "$tmp_file"
    return 0
  else
    local exit_code=$?
    local end_time
    end_time=$(date +%s.%N 2>/dev/null || date +%s)
    local duration
    duration=$(awk "BEGIN {printf \"%.1f\", $end_time - $start_time}" 2>/dev/null || echo "0")
    local formatted_duration
    formatted_duration=$(format_duration "$duration")

    printf "  ${RED}FAIL${NC} %s ${YELLOW}[%s]${NC}\n" "$description" "$formatted_duration"
    echo ""
    echo "----------------------------------------------------------------"
    echo "FAILURE OUTPUT: $description"
    echo "----------------------------------------------------------------"
    cat "$tmp_file"
    echo "----------------------------------------------------------------"
    rm -f "$tmp_file"
    return "$exit_code"
  fi
}

run_silent_bail() {
  local description="$1"
  local command="$2"

  if ! run_silent "$description" "$command"; then
    echo ""
    printf "${RED}Bailing out after failure in: %s${NC}\n" "$description"
    exit 1
  fi
}

run_phase() {
  local phase_name="$1"
  shift

  echo ""
  printf "${YELLOW}> %s${NC}\n" "$phase_name"
  echo "----------------------------------------------------------------"

  local failed=0
  while [[ $# -ge 2 ]]; do
    local desc="$1"
    local cmd="$2"
    shift 2

    if ! run_silent "$desc" "$cmd"; then
      failed=1
    fi
  done

  return $failed
}

export -f run_silent
export -f run_silent_bail
export -f run_phase
export -f extract_summary
export -f format_duration
