# Runbooks

## Configure local env files (idempotent)
`pnpm env:configure`

## Start local infra
`pnpm infra:ensure`

## Ensure shared infra from any worktree
`./scripts/worktree/ensure-shared-infra.sh`

## MCP setup (Claude Code + Codex)
1. `cp .env.example .env`
2. Fill required secrets in `.env` (`SUPABASE_ACCESS_TOKEN`; optional `CONTEXT7_API_KEY`).
3. Ensure Docker is running (Prometheus MCP uses container runtime).
4. Claude Code uses project `.mcp.json` automatically.
5. For Codex, run `pnpm mcp:codex-config`, then copy the output into `~/.codex/config.toml`.

## Run services
`pnpm dev`
- Runs `web + api + worker` as local processes.
- Docker is shared infra-first (`pnpm infra:ensure`) for local development.

## Apply migrations
`pnpm db:migrate`

## Validate DB trigger contracts (pgTAP)
`pnpm test:db:pgtap`

## Add a custom DB trigger
1. Run `pnpm db:trigger:new --name <trigger-name> --table <table> [--timing BEFORE|AFTER] [--events INSERT,UPDATE] [--level ROW|STATEMENT]`.
2. Implement trigger function logic in the generated migration under `packages/db/drizzle/migrations/`.
3. Replace scaffold `fail(...)` assertion in the generated `packages/db/pgtap/*.pgtap.sql` suite with concrete trigger assertions.
4. Run `pnpm db:migrate` and `pnpm test:db:pgtap`.

## Compute deterministic worktree ports
`pnpm worktree:ports feature-my-branch`

## Setup a worktree with isolated app ports
`scripts/worktree/setup.sh <worktree-path>`
- Writes worktree-local env keys:
  - `WEB_PORT`
  - `API_PORT`
  - `MOBILE_PORT`
  - `WORKER_INSPECT_PORT`
  - `API_BASE_URL`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_API_BASE_URL`

## Reset integration DB state (idempotent)
`pnpm db:test:reset`
- DB reset and integration runners use PID-aware lock files under `/tmp/tx-agent-kit-*.lock`; stale locks are reaped automatically.

## Run integration tests (idempotent, no container teardown)
`pnpm test:integration`
- Integration runs through a single Vitest workspace with one global setup (`vitest.integration.workspace.ts`).
- Select subsets with `INTEGRATION_PROJECTS=web` or `INTEGRATION_PROJECTS=api,testkit pnpm test:integration`.
- Unit suites default to host CPU parallelism; cap with `TEST_MAX_WORKERS=<n>`.
- Integration suites default to host CPU parallelism; cap with `INTEGRATION_MAX_WORKERS=<n>`.
- Override web suite workers with `WEB_INTEGRATION_MAX_WORKERS=<n>` (defaults to `INTEGRATION_MAX_WORKERS`).
- For faster local iteration, skip pgTAP during integration setup with `pnpm test:integration --skip-pgtap` (keep pgTAP enabled in CI).
- Web integration keeps one API+DB harness per worker slot warm across files and performs per-test resets.

## Check run-silent behavior
`pnpm test:run-silent`

## Shutdown infra
`pnpm infra:down`

## Staging/Production deployment
1. Build/push images and capture artifact:
   - `PUSH_IMAGES=1 pnpm deploy:build-images`
2. Run migrations:
   - `pnpm deploy:migrate:staging` or `pnpm deploy:migrate:prod`
3. Deploy:
   - `pnpm deploy:staging deploy/artifacts/images-<sha>.env`
   - `pnpm deploy:prod deploy/artifacts/images-<sha>.env`
4. Smoke verification:
   - `API_BASE_URL=https://<api-host> pnpm deploy:smoke`
