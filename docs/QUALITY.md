# Quality

- Enforce package boundaries with ESLint.
- Enforce structured logging with `no-console` + `@tx-agent-kit/logging`.
- Keep tests idempotent and deterministic.
- Run unit tests via `pnpm test`.
- Run integration tests against Docker infra via `pnpm test:integration`.
- Run invariant checks via `pnpm lint` (`eslint` + `scripts/lint/enforce-domain-invariants.mjs`).

## Domain Invariants

- API-first web: `apps/web` never imports `@tx-agent-kit/db` or `drizzle-orm`.
- Logging discipline: `console.*` is banned; use `@tx-agent-kit/logging`.
- Drizzle isolation: only `packages/db` imports `drizzle-orm`.
- Schema-first boundaries: domain request/response validation is done with `effect/Schema` (zod is banned).
- Table schema parity: each database table has a corresponding Effect schema under `packages/db/src/effect-schemas/`.
- Table factory parity: each database table has a corresponding factory under `packages/db/src/factories/`.
- Contract governance: `apps/api/openapi.json` is generated from `apps/api` and carries closed DDD invariants (`x-ddd` + per-route `x-invariants`).

## DDD Layer Direction

- `domain` imports only `domain`.
- `ports` imports only `domain|ports`.
- `repositories|adapters` import only `domain|ports|self`.
- `services` import only `domain|ports|repositories|adapters|self`.
- `runtime|ui` are orchestration/presentation layers and must not invert dependencies back into persistence concerns.
