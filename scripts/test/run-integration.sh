#!/usr/bin/env bash
# Idempotent integration test runner.
# Keeps containers alive, resets DB state, then runs integration suites.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

"$PROJECT_ROOT/scripts/test/reset-test-db.sh"

echo "Running integration tests..."
pnpm exec turbo run test:integration "$@"
