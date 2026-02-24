# tx-agent-kit

Agent-first TypeScript monorepo for building scalable apps with Effect, Temporal, Next.js, Drizzle, and observability-first feedback loops.

## Stack
- `apps/web`: Next.js 16 frontend with auth, dashboard, workspaces, invitations, and tasks.
- `apps/mobile`: Expo React Native app for auth/workspaces/tasks/invitations.
- `apps/api`: Effect HTTP API for auth/workspaces/invitations/tasks.
- `apps/worker`: Temporal worker and workflows.
- `packages/core`: Effect services and domain logic.
- `packages/db`: Drizzle schema, repositories, migrations, and table-aligned Effect schemas.
- `packages/logging`: Structured JSON logger package for all services.
- `packages/contracts`: Shared contracts and `effect/Schema` definitions.
- `packages/auth`: Password/JWT primitives.
- `packages/observability`: OpenTelemetry bootstrap utilities.
- `monitoring/local`: Prometheus, Jaeger, Grafana, and OTel collector for local infra.

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

This is an opinionated stack. The toolchain below is required, not optional.

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | 22+ | [nodejs.org](https://nodejs.org) |
| **pnpm** | 10+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| **Docker Desktop** | 24+ | [docker.com](https://www.docker.com/products/docker-desktop/) |
| **Temporal CLI** | Latest | `brew install temporal` or [docs.temporal.io/cli](https://docs.temporal.io/cli) |

**Optional (for staging/production deploys):**
| Tool | Version | Install |
|------|---------|---------|
| **1Password CLI** (`op`) | 2.x | [1password.com/downloads/command-line](https://1password.com/downloads/command-line/) |

Verify:
```bash
node --version      # v22+
pnpm --version      # 10+
docker --version    # 24+
temporal version    # any recent
```

## Quickstart
```bash
pnpm install
pnpm env:configure
pnpm infra:ensure
pnpm temporal:dev:up
pnpm db:migrate
pnpm dev
```

## Local Endpoints
- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Temporal CLI status: `pnpm temporal:dev:status`
- Prometheus: `http://localhost:9090`
- Jaeger UI: `http://localhost:16686`
- Loki: `http://localhost:3100`
- Grafana: `http://localhost:3001` (`admin` / `admin`)

## Common Commands
```bash
pnpm dev                 # run web + api + worker
pnpm temporal:dev:up     # start local Temporal CLI (mode=cli)
pnpm temporal:dev:down   # stop local Temporal CLI
pnpm temporal:dev:status # inspect local Temporal CLI health
pnpm dev:web             # web only
pnpm dev:mobile          # mobile only
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
pnpm test:temporal:integration        # opt-in Temporal integration lane (not default integration)
pnpm test:temporal:cloud:integration  # opt-in Temporal Cloud lane (requires guards/creds)
pnpm test:dev:hot-reload              # opt-in hot-reload smoke (web/api/mobile/worker)
pnpm openapi:generate
pnpm api:client:generate
pnpm mobile:generate:api
PUSH_IMAGES=1 pnpm deploy:build-images
pnpm deploy:migrate:staging
pnpm deploy:staging deploy/artifacts/images-<git-sha>.env
pnpm db:migrate
pnpm db:test:reset
pnpm db:studio
pnpm infra:ensure
pnpm infra:down
pnpm worktree:ports feature-my-branch
pnpm test:run-silent
pnpm tx --help
pnpm tx db trigger new --name normalize-project-email --table invitations --timing BEFORE --events INSERT,UPDATE
pnpm db:trigger:new --name normalize-project-email --table invitations --timing BEFORE --events INSERT,UPDATE
pnpm scaffold:crud --domain billing --entity invoice --dry-run
pnpm scaffold:crud --domain billing --entity invoice --with-db
```

## Docker (Local Infra Only)
```bash
docker compose -p tx-agent-kit --profile infra up -d
docker compose -p tx-agent-kit down -v
```

`infra` brings up Postgres, Redis, Jaeger, Prometheus, Grafana, and OTel Collector.
Local development runs `web + api + worker` as hot-reloading local processes (`pnpm dev`) while reusing shared Docker infra and local Temporal CLI.
Staging/production app containers (`api`, `worker`) are deployed via `docker-compose.staging.yml` / `docker-compose.prod.yml`.

## Worktrees + Idempotent Integration Tests
- Infrastructure is shared across worktrees with a fixed compose project: `tx-agent-kit`.
- Collision-aware deterministic worktree port offsets include `WEB_PORT`, `API_PORT`, `MOBILE_PORT`, and `WORKER_INSPECT_PORT` via `pnpm worktree:ports <name>`.
- Worktree setup writes `TEMPORAL_TASK_QUEUE=tx-agent-kit-<worktree-name>` so local workers do not contend on the same queue.
- `pnpm infra:ensure` is idempotent: it checks health first, only starts missing services, and never tears down containers.
- Override infra readiness timeout when needed: `INFRA_READY_TIMEOUT_SECONDS=300 pnpm infra:ensure`.
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
- Deployment: `docs/DEPLOYMENT.md`
- Rollback: `docs/ROLLBACK.md`
- OctoSpark mining log: `todo/octospark-mining.md`
- API contract (generated): `apps/api/openapi.json`
