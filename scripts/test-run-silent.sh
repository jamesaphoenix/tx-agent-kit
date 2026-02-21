#!/usr/bin/env bash
# Regression test for scripts/run-silent.sh behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

SUCCESS_LOG="$TMP_DIR/success.log"
FAIL_LOG="$TMP_DIR/fail.log"

run_silent "success case" "echo ok" > "$SUCCESS_LOG"
if grep -q "ok" "$SUCCESS_LOG"; then
  echo "run-silent regression failed: success output should be compact"
  exit 1
fi

set +e
run_silent "failure case" "echo error-output && exit 1" > "$FAIL_LOG" 2>&1
FAIL_EXIT=$?
set -e

if [[ "$FAIL_EXIT" -eq 0 ]]; then
  echo "run-silent regression failed: failure must return non-zero"
  exit 1
fi

if ! grep -q "error-output" "$FAIL_LOG"; then
  echo "run-silent regression failed: failure output must be printed"
  exit 1
fi

echo "run-silent regression checks passed."
