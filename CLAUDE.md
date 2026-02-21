# tx-agent-kit Claude Guide

This repository uses an agent-first workflow inspired by OpenAI's Harness Engineering post (February 11, 2026).

## Operating Model
- Humans steer intent and acceptance criteria.
- Agents implement, validate, and iterate with mechanical checks.
- If an agent fails repeatedly, improve scaffolding (docs, linters, tests, scripts).

## Hard Constraints
- Use `effect/Schema` only for validation/contracts.
- Never import `drizzle-orm` outside `packages/db`.
- Never query DB directly from `apps/web`.
- Keep `apps/api/openapi.json` generated from `apps/api` (`pnpm openapi:generate`).
- Maintain table-to-schema parity in `packages/db/src/effect-schemas`.
- Maintain table-to-factory parity in `packages/db/src/factories`.
- Use `@tx-agent-kit/logging` for structured logs (`console.*` is lint-banned).

## DDD Construction Pattern
For each domain, create:

```txt
packages/core/src/domains/<domain>/
  domain/         # entities/value objects/pure rules
  ports/          # interfaces/capability contracts
  repositories/   # persistence implementations
  services/       # use-case orchestration
  runtime/        # layer wiring (optional)
  adapters/       # external system adapters (optional)
  ui/             # presentation-facing layer (optional)
```

Dependency direction must stay inward:
- `domain` imports only `domain`.
- `ports` imports `domain|ports`.
- `repositories|adapters` import `domain|ports|self`.
- `services` import `domain|ports|repositories|adapters|self`.
- `runtime|ui` may import outer orchestration layers.

## Required Workflow For New Features
1. Add/extend contracts in `packages/contracts` with `effect/Schema`.
2. Add domain logic under `packages/core/src/domains/<domain>/...`.
3. If persistence changes, update `packages/db/src/schema.ts` and matching `packages/db/src/effect-schemas/*.ts`.
4. Add/update matching table factory in `packages/db/src/factories/*.factory.ts`.
5. Expose API behavior from `apps/api`, then regenerate OpenAPI.
6. Run `pnpm lint && pnpm type-check && pnpm test`.

## Mechanical Enforcement
- ESLint restrictions live in `packages/tooling/eslint-config/domain-invariants.js`.
- Structural checks live in `scripts/lint/enforce-domain-invariants.mjs`.
- Shell checks live in `scripts/check-shell-invariants.sh`.
- `pnpm lint` executes ESLint + structural invariants + shell invariants.

## Infra + Test Reliability
- Use `pnpm env:configure` to seed local env files idempotently.
- Use `pnpm infra:ensure` to start shared local infrastructure across worktrees.
- Use `pnpm test:integration` for integration suites (idempotent DB reset + no container teardown).
- Prefer quiet runners first to reduce context bloat:
  - `pnpm lint:quiet`
  - `pnpm type-check:quiet`
  - `pnpm test:quiet`
  - `pnpm test:integration:quiet`
- Switch to full commands (`pnpm lint`, `pnpm type-check`, `pnpm test`) when detailed diagnostics are needed.

## Repository Knowledge Discipline
- Keep `AGENTS.md` and this file short and map-like.
- Move durable decisions into versioned docs/code.
- Treat in-repo artifacts as the only reliable knowledge source for agents.
