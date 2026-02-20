# Runbooks

## Start local infra
`pnpm infra:up`

## MCP observability setup (Claude Code + Codex)
1. `cp .env.mcp.example .env.mcp`
2. Ensure Docker is running (Prometheus MCP uses container runtime).
3. Claude Code uses project `.mcp.json` automatically.
4. Codex reads global entries from `~/.codex/config.toml` that point to `scripts/mcp/*.sh`.

## Run services
`pnpm dev`

## Apply migrations
`pnpm db:migrate`

## Shutdown infra
`pnpm infra:down`
