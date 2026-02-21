# Runbooks

## Configure local env files (idempotent)
`pnpm env:configure`

## Start local infra
`pnpm infra:ensure`

## Ensure shared infra from any worktree
`./scripts/worktree/ensure-shared-infra.sh`

## MCP setup (Claude Code + Codex)
1. `cp .env.mcp.example .env.mcp`
2. Fill required secrets in `.env.mcp` (`SUPABASE_ACCESS_TOKEN`; optional `CONTEXT7_API_KEY`).
3. Ensure Docker is running (Prometheus MCP uses container runtime).
4. Claude Code uses project `.mcp.json` automatically.
5. For Codex, run `pnpm mcp:codex-config`, then copy the output into `~/.codex/config.toml`.

## Run services
`pnpm dev`

## Apply migrations
`pnpm db:migrate`

## Compute deterministic worktree ports
`pnpm worktree:ports feature-my-branch`

## Reset integration DB state (idempotent)
`pnpm db:test:reset`

## Run integration tests (idempotent, no container teardown)
`pnpm test:integration`

## Check run-silent behavior
`pnpm test:run-silent`

## Shutdown infra
`pnpm infra:down`
