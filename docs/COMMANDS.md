# Commands

## Core Development
- `pnpm env:configure`: idempotently configure `.env` for local development.
- `pnpm infra:ensure`: idempotently start shared Docker infra and wait for health.
- `pnpm dev`: run web + api + worker locally (outside Docker app profile).
- `pnpm openapi:generate`: regenerate `apps/api/openapi.json` from API definitions.
- `pnpm api:client:generate`: regenerate `apps/api/openapi.json` and web Orval hooks in `apps/web/lib/api/generated`.
- `pnpm scaffold:crud --domain <domain> --entity <entity> [--dry-run] [--force]`: generate `domain -> ports -> application/adapters -> routes -> tests` scaffold.

## Quality Gates
- `pnpm lint`: full lint gate (`eslint` + structural/runtime invariants + shell invariants).
- `pnpm type-check`: workspace TypeScript checks.
- `pnpm test`: workspace unit tests.
- `pnpm test:integration`: single Vitest workspace integration run with global setup (infra + DB reset + pgTAP once).
- `pnpm test:db:pgtap`: run pgTAP database contract suites (triggers/invariants).
- `GRAFANA_PORT=13001 pnpm test:integration:quiet`: run integration tests when local `3001` is occupied.

## Quiet Runners (Agent-Optimized)
- `pnpm build:quiet`
- `pnpm lint:quiet`
- `pnpm type-check:quiet`
- `pnpm test:quiet`
- `pnpm test:integration:quiet`
- Integration workspace runners use a shared lock (`/tmp/tx-agent-kit-integration.lock`) with PID-aware stale-lock reaping.
- `TEST_MAX_WORKERS=8 pnpm test`: cap workspace unit-test workers (defaults to host CPU parallelism).
- `INTEGRATION_PROJECTS=web pnpm test:integration`: run selected integration project(s) (`api,testkit,web,worker`).
- `INTEGRATION_MAX_WORKERS=4 pnpm test:integration`: cap non-web integration workers (defaults to host CPU parallelism).
- `WEB_INTEGRATION_MAX_WORKERS=2 pnpm --filter @tx-agent-kit/web test:integration`: override web integration workers (defaults to `INTEGRATION_MAX_WORKERS`, then host CPU parallelism).
- `pnpm test:integration --skip-pgtap`: skip pgTAP in global setup for faster local red/green loops.
- Web integration uses one warm API+DB harness per Vitest pool slot (instead of booting per file).

## DB + Worktrees
- `pnpm db:migrate`: run Drizzle migrations.
- `pnpm db:trigger:new --name <trigger-name> --table <table> [--timing BEFORE|AFTER] [--events INSERT,UPDATE] [--level ROW|STATEMENT]`: scaffold migration + pgTAP contract for a custom trigger.
- `pnpm db:test:reset`: idempotently reset integration DB state without tearing down containers.
- `pnpm worktree:ports <name>`: derive deterministic local ports for a worktree (`WEB_PORT`, `API_PORT`, `MOBILE_PORT`, `WORKER_INSPECT_PORT`, observability UI ports).

## Deployment
- `PUSH_IMAGES=1 pnpm deploy:build-images`: build and push API/worker images, then emit image artifact env file in `deploy/artifacts/`.
- `pnpm deploy:migrate:staging`: run DB migrations with staging secrets from 1Password template.
- `pnpm deploy:migrate:prod`: run DB migrations with production secrets from 1Password template.
- `pnpm deploy:staging [deploy/artifacts/images-<sha>.env]`: render staging env with `op inject`, deploy compose services, run smoke checks.
- `pnpm deploy:prod [deploy/artifacts/images-<sha>.env]`: render production env with `op inject`, deploy compose services, run smoke checks.
- `API_BASE_URL=https://<api-host> pnpm deploy:smoke`: run API critical-flow smoke checks.

## MCP Servers
- `pnpm mcp:prometheus`: start Prometheus MCP (containerized server).
- `pnpm mcp:jaeger`: start Jaeger MCP.
- `pnpm mcp:context7`: start Context7 MCP.
- `pnpm mcp:supabase`: start Supabase MCP (requires `SUPABASE_ACCESS_TOKEN`).
- `pnpm mcp:playwright`: start Playwright MCP.
- `pnpm mcp:codex-config`: print Codex MCP TOML blocks wired to local wrappers.

## Diagnostics
- `pnpm test:run-silent`: verify `scripts/run-silent.sh` behavior.
