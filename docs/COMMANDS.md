# Commands

## Core Development
- `pnpm env:configure`: idempotently configure `.env` and `.env.mcp` for local development.
- `pnpm infra:ensure`: idempotently start shared Docker infra and wait for health.
- `pnpm dev`: run web + api + worker.
- `pnpm openapi:generate`: regenerate `apps/api/openapi.json` from API definitions.

## Quality Gates
- `pnpm lint`: full lint gate (`eslint` + domain invariants + shell invariants).
- `pnpm type-check`: workspace TypeScript checks.
- `pnpm test`: workspace unit tests.
- `pnpm test:integration`: idempotent integration run (ensures infra + resets DB + runs suites).

## Quiet Runners (Agent-Optimized)
- `pnpm build:quiet`
- `pnpm lint:quiet`
- `pnpm type-check:quiet`
- `pnpm test:quiet`
- `pnpm test:integration:quiet`

## DB + Worktrees
- `pnpm db:migrate`: run Drizzle migrations.
- `pnpm db:test:reset`: idempotently reset integration DB state without tearing down containers.
- `pnpm worktree:ports <name>`: derive deterministic local ports for a worktree.

## Diagnostics
- `pnpm test:run-silent`: verify `scripts/run-silent.sh` behavior.
