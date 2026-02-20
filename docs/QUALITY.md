# Quality

- Enforce package boundaries with ESLint.
- Keep tests idempotent and deterministic.
- Run unit tests via `pnpm test`.
- Run integration tests against Docker infra via `pnpm test:integration`.

## Domain Invariants

- API-first web: `apps/web` never imports `@tx-agent-kit/db` or `drizzle-orm`.
- Drizzle isolation: only `packages/db` imports `drizzle-orm`.
- Schema-first boundaries: domain request/response validation is done with `effect/Schema` (zod is banned).
- Table schema parity: each database table has a corresponding Effect schema under `packages/db/src/effect-schemas/`.
- Contract governance: `OpenAPI.yml` is the external contract and carries closed DDD invariants (`x-ddd` + per-route `x-invariants`).
