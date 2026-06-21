#!/usr/bin/env bash
# auto-fix-runner.sh — launchd + manual entrypoint for the host auto-fix
# Temporal worker (apps/auto-fix-runner).
#
# Runs on a single host (NOT in a container) because the activity spawns the
# codex/claude CLI + git/gh. Concurrency is enforced by Temporal
# (maxConcurrentActivityTaskExecutions: 1), so there is no lock file here.
#
# Usage:
#   AUTO_FIX_ENABLED=true ./scripts/auto-fix-runner.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Source secrets via the env helper (op:// references resolved when present).
if [[ -f scripts/lib/source-env.sh ]]; then
  # shellcheck disable=SC1091
  source scripts/lib/source-env.sh
  source_env .env || true
fi

# Kill switch: refuse to run unless explicitly enabled.
if [[ "${AUTO_FIX_ENABLED:-false}" != "true" && "${AUTO_FIX_ENABLED:-0}" != "1" ]]; then
  echo "[auto-fix-runner] AUTO_FIX_ENABLED is not set to true; exiting." >&2
  exit 0
fi

# Install (link any new deps from the committed lockfile — the host is a plain
# checkout, not a CI runner that installs separately) then build, then run.
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @tx-agent-kit/auto-fix-runner build
exec node apps/auto-fix-runner/dist/index.js
