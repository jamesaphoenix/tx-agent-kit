#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

HOT_RELOAD_LOG_DIR="${HOT_RELOAD_LOG_DIR:-/tmp/tx-agent-kit-hot-reload}"
mkdir -p "$HOT_RELOAD_LOG_DIR"

running_pids=""

append_pid() {
  local pid="$1"
  if [[ -n "$running_pids" ]]; then
    running_pids="${running_pids} ${pid}"
  else
    running_pids="${pid}"
  fi
}

stop_pid() {
  local pid="$1"
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return
  fi

  kill "$pid" >/dev/null 2>&1 || true
  pkill -P "$pid" >/dev/null 2>&1 || true
  sleep 1
  kill -9 "$pid" >/dev/null 2>&1 || true
  pkill -9 -P "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  for pid in $running_pids; do
    stop_pid "$pid"
  done
}
trap cleanup EXIT

wait_for_pattern() {
  local file="$1"
  local pattern="$2"
  local timeout_seconds="$3"

  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_seconds" ]]; do
    if grep -Eq "$pattern" "$file"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Timed out waiting for pattern '${pattern}' in ${file}"
  tail -n 120 "$file" || true
  return 1
}

wait_for_http_200() {
  local url="$1"
  local timeout_seconds="$2"

  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_seconds" ]]; do
    http_code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ "$http_code" == "200" ]]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Timed out waiting for HTTP 200 from ${url}"
  return 1
}

echo "Ensuring local infrastructure and Temporal runtime prerequisites..."
pnpm infra:ensure
pnpm temporal:dev:up

echo "Checking API hot-reload..."
api_log_file="${HOT_RELOAD_LOG_DIR}/api.log"
API_PORT="${HOT_RELOAD_API_PORT:-4510}" pnpm --filter @tx-agent-kit/api dev >"$api_log_file" 2>&1 &
api_pid="$!"
append_pid "$api_pid"
wait_for_pattern "$api_log_file" 'Starting API server\.' 30
touch apps/api/src/server.ts
wait_for_pattern "$api_log_file" 'change in \./src/server\.ts Restarting\.\.\.' 30
stop_pid "$api_pid"

echo "Checking Worker hot-reload..."
worker_log_file="${HOT_RELOAD_LOG_DIR}/worker.log"
WORKER_INSPECT_PORT="${HOT_RELOAD_WORKER_INSPECT_PORT:-9439}" \
pnpm --filter @tx-agent-kit/worker dev >"$worker_log_file" 2>&1 &
worker_pid="$!"
append_pid "$worker_pid"
wait_for_pattern "$worker_log_file" 'Temporal worker started\.|Connection refused|TransportError' 30
touch apps/worker/src/index.ts
wait_for_pattern "$worker_log_file" 'change in \./src/index\.ts Rerunning\.\.\.' 30
stop_pid "$worker_pid"

echo "Checking Web hot-reload..."
web_log_file="${HOT_RELOAD_LOG_DIR}/web.log"
web_port="${HOT_RELOAD_WEB_PORT:-3510}"
WEB_PORT="$web_port" pnpm --filter @tx-agent-kit/web dev >"$web_log_file" 2>&1 &
web_pid="$!"
append_pid "$web_pid"
wait_for_pattern "$web_log_file" 'Ready' 45
wait_for_http_200 "http://localhost:${web_port}/" 45
touch apps/web/app/page.tsx
wait_for_http_200 "http://localhost:${web_port}/" 45
stop_pid "$web_pid"

echo "Checking Mobile dev watcher startup..."
mobile_log_file="${HOT_RELOAD_LOG_DIR}/mobile.log"
mobile_port="${HOT_RELOAD_MOBILE_PORT:-9181}"
MOBILE_PORT="$mobile_port" pnpm --filter @tx-agent-kit/mobile dev >"$mobile_log_file" 2>&1 &
mobile_pid="$!"
append_pid "$mobile_pid"
wait_for_pattern "$mobile_log_file" "Waiting on http://localhost:${mobile_port}" 60
touch apps/mobile/app/index.tsx
sleep 3
if ! kill -0 "$mobile_pid" >/dev/null 2>&1; then
  echo "Mobile dev server exited unexpectedly after source change."
  tail -n 120 "$mobile_log_file" || true
  exit 1
fi
stop_pid "$mobile_pid"

echo "Hot-reload smoke checks passed for api/worker/web/mobile."
