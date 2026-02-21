#!/usr/bin/env bash
# Worktree helper to ensure shared infra is up.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"
"$PROJECT_ROOT/scripts/start-dev-services.sh"
