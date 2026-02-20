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
- DDD import direction is enforced: `domain <- ports <- repositories/adapters <- services <- runtime/ui`.
- `apps/api/openapi.json` is generated from `apps/api` and is the external contract reference.

## Prerequisites
- Node.js `>=22`
- pnpm `10.x`
- Docker (for infra and MCP Prometheus server)

## Quickstart
```bash
cp .env.example .env
cp .env.mcp.example .env.mcp
pnpm install
pnpm infra:up
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
pnpm lint:invariants
pnpm type-check
pnpm test
pnpm test:integration
pnpm openapi:generate
pnpm db:migrate
pnpm db:studio
pnpm infra:up
pnpm infra:down
```

## Docker Profiles
```bash
docker compose --profile infra up -d
docker compose --profile infra --profile app up --build
docker compose down -v
```

`infra` brings up Postgres, Temporal, Jaeger, Prometheus, Grafana, and OTel Collector.  
`app` builds and runs API and worker containers.

## MCP Observability (Codex + Claude Code)
- Project MCP config lives in `.mcp.json`.
- MCP wrappers live in `scripts/mcp/`.
- Configure endpoints in `.env.mcp`.

```bash
pnpm mcp:prometheus
pnpm mcp:jaeger
```

## Docs
- Agent map and guardrails: `AGENTS.md`
- Claude operating guide: `CLAUDE.md`
- Architecture: `docs/ARCHITECTURE.md`
- Quality and boundaries: `docs/QUALITY.md`
- Runbooks: `docs/RUNBOOKS.md`
- API contract (generated): `apps/api/openapi.json`
