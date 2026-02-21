#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cat <<TOML
# tx-agent-kit MCP servers
# Copy these blocks into ~/.codex/config.toml

[mcp_servers.prometheus-local]
command = "${ROOT_DIR}/scripts/mcp/prometheus.sh"

[mcp_servers.jaeger-local]
command = "${ROOT_DIR}/scripts/mcp/jaeger.sh"

[mcp_servers.context7]
command = "${ROOT_DIR}/scripts/mcp/context7.sh"

[mcp_servers.supabase]
command = "${ROOT_DIR}/scripts/mcp/supabase.sh"

[mcp_servers.playwright]
command = "${ROOT_DIR}/scripts/mcp/playwright.sh"
TOML
