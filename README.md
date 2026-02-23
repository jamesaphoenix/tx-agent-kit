# tx-agent-kit

Agent-first TypeScript monorepo for building scalable apps with Effect, Temporal, Next.js, Drizzle, and observability-first feedback loops.

## Stack
- `apps/web`: Next.js 16 frontend with auth, dashboard, workspaces, invitations, and tasks.
- `apps/api`: Effect HTTP API for auth/workspaces/invitations/tasks.
- `apps/worker`: Temporal worker and workflows.
- `packages/core`: Effect services and domain logic.
- `packages/db`: Drizzle schema, repositories, migrations, and table-aligned Effect schemas.
- `packages/logging`: Structured JSON logger package for all services.
- `packages/contracts`: Shared contracts and `effect/Schema` definitions.
- `packages/auth`: Password/JWT primitives.
- `packages/observability`: OpenTelemetry bootstrap utilities.
- `monitoring/local`: Prometheus, Jaeger, Grafana, OTel collector, Temporal local stack.

## Invariants
- Web is API-first and never queries Postgres directly.
- Domain boundaries are schema-first with `effect/Schema` (zod is banned).
- Only `packages/db` imports `drizzle-orm`.
- Every DB table has a matching Effect schema in `packages/db/src/effect-schemas`.
- Every DB table has a matching factory in `packages/db/src/factories`.
- `console.*` is banned; use `@tx-agent-kit/logging`.
- DDD import direction is enforced with ports as the seam: `domain <- ports <- application <- runtime/ui` and `domain <- ports <- adapters <- runtime/ui`.
- `apps/api/openapi.json` is generated from `apps/api` and is the external contract reference.
- Routes and repositories must declare explicit kind markers (`crud` vs `custom`) and keep kind intent consistent.

## Prerequisites
- Node.js `>=22`
- pnpm `10.x`
- Docker (for infra and MCP Prometheus server)

## Quickstart
```bash
pnpm install
pnpm env:configure
pnpm infra:ensure
pnpm db:migrate
pnpm dev
```

## Local Endpoints
- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Temporal UI: `http://localhost:8233`
- Prometheus: `http://localhost:9090`
- Jaeger UI: `http://localhost:16686`
- Loki: `http://localhost:3100`
- Grafana: `http://localhost:3001` (`admin` / `admin`)

## Common Commands
```bash
pnpm dev                 # run web + api + worker
pnpm dev:web             # web only
pnpm dev:api             # api only
pnpm dev:worker          # worker only
pnpm lint
pnpm lint:quiet
pnpm lint:invariants
pnpm type-check
pnpm type-check:quiet
pnpm test
pnpm test:quiet
pnpm test:integration
pnpm test:integration:quiet
pnpm openapi:generate
pnpm api:client:generate
pnpm db:migrate
pnpm db:test:reset
pnpm db:studio
pnpm infra:ensure
pnpm infra:down
pnpm worktree:ports feature-my-branch
pnpm test:run-silent
pnpm scaffold:crud --domain billing --entity invoice --dry-run
pnpm scaffold:crud --domain billing --entity invoice
```

## Docker Profiles
```bash
docker compose -p tx-agent-kit --profile infra up -d
docker compose -p tx-agent-kit --profile infra --profile app up --build
docker compose -p tx-agent-kit down -v
```

`infra` brings up Postgres, Temporal, Jaeger, Prometheus, Grafana, and OTel Collector.  
`app` builds and runs API and worker containers.

## Worktrees + Idempotent Integration Tests
- Infrastructure is shared across worktrees with a fixed compose project: `tx-agent-kit`.
- `pnpm infra:ensure` is idempotent: it checks health first, only starts missing services, and never tears down containers.
- `pnpm test:integration` is idempotent: it runs one Vitest workspace integration run with global setup (infra + DB reset + pgTAP once).
- Select subset projects with `INTEGRATION_PROJECTS=web` or `INTEGRATION_PROJECTS=api,testkit`.
- Unit and integration workers default to host CPU parallelism.
- Tune unit parallelism with `TEST_MAX_WORKERS`.
- Tune integration parallelism with `INTEGRATION_MAX_WORKERS`.
- Override only web integration workers with `WEB_INTEGRATION_MAX_WORKERS` when needed.
- Use `pnpm test:integration --skip-pgtap` for faster local loops; keep pgTAP enabled in CI.
- `pnpm db:test:reset` can be run manually before local integration/dev sessions.

## MCP Servers (Codex + Claude Code)
- Project MCP config lives in `.mcp.json`.
- MCP wrappers live in `scripts/mcp/`.
- Configure endpoints in `.env` (`SUPABASE_ACCESS_TOKEN` is required for Supabase MCP).

```bash
pnpm mcp:prometheus
pnpm mcp:jaeger
pnpm mcp:context7
pnpm mcp:supabase
pnpm mcp:playwright
pnpm mcp:codex-config
```

Use `pnpm mcp:codex-config` to print TOML blocks for `~/.codex/config.toml` that reference the same project wrappers.

## Docs
- Agent map and guardrails: `AGENTS.md`
- Claude operating guide: `CLAUDE.md`
- Architecture: `docs/ARCHITECTURE.md`
- Commands: `docs/COMMANDS.md`
- Quality and boundaries: `docs/QUALITY.md`
- Runbooks: `docs/RUNBOOKS.md`
- OctoSpark mining log: `todo/octospark-mining.md`
- API contract (generated): `apps/api/openapi.json`
