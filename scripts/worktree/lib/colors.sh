#!/usr/bin/env bash
set -euo pipefail

if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

log_info() {
  printf "%bℹ%b %s\n" "$BLUE" "$NC" "$1"
}

log_success() {
  printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"
}

log_warn() {
  printf "%b!%b %s\n" "$YELLOW" "$NC" "$1"
}

log_error() {
  printf "%b✗%b %s\n" "$RED" "$NC" "$1" >&2
}
