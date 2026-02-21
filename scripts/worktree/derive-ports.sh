#!/usr/bin/env bash
# Deterministic port assignment for worktrees.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <worktree-name>"
  exit 1
fi

WORKTREE_NAME="$1"

if [[ ! "$WORKTREE_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Invalid worktree name: '$WORKTREE_NAME'"
  echo "Allowed: alphanumeric, hyphen, underscore"
  exit 1
fi

if command -v md5sum >/dev/null 2>&1; then
  HASH=$(echo -n "$WORKTREE_NAME" | md5sum | cut -c1-4)
elif command -v md5 >/dev/null 2>&1; then
  HASH=$(echo -n "$WORKTREE_NAME" | md5 | cut -c1-4)
else
  HASH=$(echo -n "$WORKTREE_NAME" | shasum | cut -c1-4)
fi

PORT_OFFSET=$(( (16#$HASH % 1000) + 100 ))

WEB_PORT=$((3000 + PORT_OFFSET))
API_PORT=$((4000 + PORT_OFFSET))
GRAFANA_PORT=$((3001 + PORT_OFFSET))
PROMETHEUS_PORT=$((9090 + PORT_OFFSET))

cat <<PORTS
WORKTREE_NAME=$WORKTREE_NAME
WORKTREE_PORT_OFFSET=$PORT_OFFSET
WEB_PORT=$WEB_PORT
API_PORT=$API_PORT
GRAFANA_PORT=$GRAFANA_PORT
PROMETHEUS_PORT=$PROMETHEUS_PORT
PORTS
