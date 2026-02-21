# tx-agent-kit

Agent-first starter for Effect HTTP + Temporal + Next.js + Drizzle.

## Repo Map
- Architecture: `docs/ARCHITECTURE.md`
- Quality + lint invariants: `docs/QUALITY.md`
- Runbooks: `docs/RUNBOOKS.md`
- Command catalog: `docs/COMMANDS.md`
- API contract: `apps/api/openapi.json` (generated via `pnpm openapi:generate`)
- Skills: `.claude/skills/*`

## Closed Invariants
- Validation library: `effect/Schema` only. (`zod` and alternatives are lint-banned)
- Logging: `console.*` is lint-banned. Use `@tx-agent-kit/logging` for structured JSON logs.
- Persistence boundary: only `packages/db` imports `drizzle-orm`.
- Web boundary: `apps/web` never imports DB modules or runs direct SQL/Drizzle access.
- Table schema parity: each `pgTable(...)` has a matching Effect schema file in `packages/db/src/effect-schemas/`.
- Table factory parity: each `pgTable(...)` has a matching test-data factory in `packages/db/src/factories/*.factory.ts`.
- Domain layering: dependencies must flow inward (`domain <- ports <- repositories/adapters <- services <- runtime/ui`).

## New Domain Creation Contract
Create domains under:

```txt
packages/core/src/domains/<domain>/
  domain/
  ports/
  repositories/
  services/
  runtime/        # optional
  adapters/       # optional
  ui/             # optional
```

Rules:
- `domain/` contains pure business rules/entities/value objects.
- `ports/` contains interfaces and capability contracts.
- `repositories/` and `adapters/` implement ports (DB, HTTP, external systems).
- `services/` orchestrates use-cases across domain + ports + repositories.
- `runtime/` wires layers into Effect `Layer`s and app entrypoints.
- `ui/` may depend on runtime/services/domain but never directly on DB.

## DB + Schema Contract
When adding a table in `packages/db/src/schema.ts`:
1. Add matching file in `packages/db/src/effect-schemas/<table-name>.ts`.
2. Export `*RowSchema` and `*RowShape` from that file.
3. Re-export it in `packages/db/src/effect-schemas/index.ts`.
4. Add matching factory file in `packages/db/src/factories/<table-name>.factory.ts`.
5. Re-export the factory in `packages/db/src/factories/index.ts`.

## Enforcement
- ESLint rules: `packages/tooling/eslint-config/domain-invariants.js`.
- Structural invariant checker: `scripts/lint/enforce-domain-invariants.mjs`.
- Shell invariant checker: `scripts/check-shell-invariants.sh`.
- Full gate: `pnpm lint` (workspace ESLint + structural invariants + shell invariants).

## Worktree + Infra Discipline
- Use `pnpm infra:ensure` (idempotent, no container teardown).
- Integration tests must run through `pnpm test:integration` (ensures infra + reset DB state).
- Derive deterministic worktree ports with `pnpm worktree:ports <name>`.
- For local setup, prefer `pnpm env:configure` over hand-editing env files.

## Context-Efficient Command Preference
- Prefer quiet runners first to reduce agent context bloat:
  - `pnpm lint:quiet`
  - `pnpm type-check:quiet`
  - `pnpm test:quiet`
  - `pnpm test:integration:quiet`
- Use full commands (`pnpm lint`, `pnpm type-check`, `pnpm test`) when you need full diagnostics or enforcing final merge gates.

## Harness Engineering References
Reference: `https://openai.com/index/harness-engineering/`
- Humans steer; agents execute.
- Keep this file short and map-like.
- Repository-local docs/code are the system of record.
- Encode architecture and taste in mechanical checks, not ad hoc prompts.
