# tx-agent-kit

Agent-first starter for Effect HTTP + Temporal + Next.js + Drizzle.

## Repo Map
- Architecture: `docs/ARCHITECTURE.md`
- Quality + lint invariants: `docs/QUALITY.md`
- Runbooks: `docs/RUNBOOKS.md`
- Command catalog: `docs/COMMANDS.md`
- API contract: `apps/api/openapi.json` (generated via `pnpm openapi:generate`)
- MCP wrappers: `scripts/mcp/*` and project MCP map `.mcp.json`
- Skills: `.claude/skills/*`
- Golden-path CRUD skill (Codex + Claude): `skills/golden-path-crud/SKILL.md`

## Closed Invariants
- Validation library: `effect/Schema` only. (`zod` and alternatives are lint-banned)
- Logging: `console.*` is lint-banned. Use `@tx-agent-kit/logging` for structured JSON logs.
- Persistence boundary: only `packages/db` imports `drizzle-orm`.
- Persistence naming boundary: core domain persistence contracts live in `ports/`; concrete repository implementations live in `packages/db/src/repositories/`.
- Web boundary: `apps/web` never imports DB modules or runs direct SQL/Drizzle access.
- Web simplicity boundary: `apps/web` must not import `effect`/`effect/*`; keep Effect runtime code in API/core/worker layers.
- Next web runtime is client-only: no `apps/web/app/api`, no `proxy.ts`/`middleware.ts`, and no `next/server` or `next/headers` imports.
- All files in `apps/web/app/**/*.tsx` and `apps/web/components/**/*.tsx` must begin with `'use client'`.
- Web auth token storage is centralized: only `apps/web/lib/auth-token.ts` may access `localStorage`.
- Web client transport must call `API_BASE_URL` directly; do not use `/api/*` proxy paths in `apps/web/lib`.
- Web URL query state is centralized via `apps/web/lib/url-state.tsx`; do not import `nuqs` directly elsewhere.
- Web notifications are centralized via `apps/web/lib/notify.tsx`; do not import `sonner` directly elsewhere.
- Do not read `window.location` directly in `apps/web`; route query parsing through `apps/web/lib/url-state.tsx`.
- Web must not call `fetch` directly; use typed API clients only.
- Table schema parity: each `pgTable(...)` has a matching Effect schema file in `packages/db/src/effect-schemas/`.
- Table factory parity: each `pgTable(...)` has a matching test-data factory in `packages/db/src/factories/*.factory.ts`.
- Route/repository intent is explicit: every API route and core repository port declares a kind marker (`crud` or `custom`) and markers must stay consistent.
- Domain layering: dependencies must flow inward with ports as the seam (`domain <- ports <- application <- runtime/ui` and `domain <- ports <- adapters <- runtime/ui`).
- Core domain folder contract: `packages/core/src/domains/*` must not contain `repositories/` or `services/`.
- Domain legibility: no default exports inside domain layer files; use named exports only.
- Source hygiene: TODO/FIXME/HACK comments are forbidden in `apps/` and `packages/` source modules.
- Domain determinism: avoid `Date.now`, `new Date`, and `Math.random` in domain layers; inject clock/random providers via ports.
- MCP entrypoints are centralized in `scripts/mcp/*`; do not hardcode ad hoc MCP startup commands in docs/scripts.
- Domain/application/routes/workflows must not read `process.env` directly; use typed config modules/layers.
- Web env access is centralized in `apps/web/lib/env.ts`; worker env access is centralized in `apps/worker/src/config/env.ts`.
- Source env policy: all `apps/**/src` and `packages/**/src` modules read env only through dedicated env modules (`apps/api/src/config/*`, `apps/worker/src/config/env.ts`, `packages/*/src/env.ts`).
- `as any` assertions are forbidden in source modules; use precise types or schema decoding from unknown.
- Chained type assertions (`as unknown as ...`) are forbidden in source modules.
- Source suppression directives are disallowed (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`) outside generated/test code.
- Test structure is colocated-only: `__tests__` folders, `.spec.ts[x]`, and `.integration.ts[x]` files are forbidden. Use `<file>.test.ts[x]` and `<file>.integration.test.ts[x]`.
- API integration tests must use `createDbAuthContext(...)`; manual process spawning/`createSqlTestContext(...)` in `apps/api/src/api.integration.test.ts` is forbidden.
- Critical-flow integration baseline is mandatory:
  - API suite must cover `/v1/auth/sign-up`, `/v1/auth/sign-in`, `/v1/auth/me`, `/v1/workspaces`, `/v1/tasks`, `/v1/invitations`, and invitation idempotency.
  - Web suite must include integration tests for `AuthForm`, `CreateWorkspaceForm`, `CreateTaskForm`, `CreateInvitationForm`, `AcceptInvitationForm`, and `SignOutButton`.
- Do not call `Effect.run*` in source modules except explicit runtime boundaries.
- Temporal workflows must remain deterministic (no `Date.now`, `new Date`, `Math.random`, or infra imports).
- Temporal workflows must not call native timers (`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`) directly.
- Empty `catch {}` blocks are forbidden in source modules; errors must be handled or rethrown explicitly.

## New Domain Creation Contract
Preferred path for CRUD slices:
- Run scaffold in dry-run mode first:
  - `pnpm scaffold:crud --domain <domain> --entity <entity> --dry-run`
- Apply scaffold:
  - `pnpm scaffold:crud --domain <domain> --entity <entity>`

Create domains under:

```txt
packages/core/src/domains/<domain>/
  domain/
  ports/
  application/
  adapters/
  runtime/        # optional
  ui/             # optional
```

Rules:
- `domain/` contains pure business rules/entities/value objects.
- `ports/` contains interfaces and capability contracts.
- `application/` orchestrates use-cases across domain + ports.
- `adapters/` implement ports (DB, HTTP, external systems).
- `runtime/` wires layers into Effect `Layer`s and app entrypoints.
- `ui/` may depend on runtime/application/domain but never directly on DB.
- `repositories/` and `services/` folders are disallowed in core domains.

## DB + Schema Contract
When adding a table in `packages/db/src/schema.ts`:
1. Add matching file in `packages/db/src/effect-schemas/<table-name>.ts`.
2. Export `*RowSchema` and `*RowShape` from that file.
3. Re-export it in `packages/db/src/effect-schemas/index.ts`.
4. Add matching factory file in `packages/db/src/factories/<table-name>.factory.ts`.
5. Re-export the factory in `packages/db/src/factories/index.ts`.
6. If you add a DB trigger, add pgTAP coverage that references the trigger name (`packages/db/pgtap/*.pgtap.sql`).

## Route + Repository Kind Contract
- In `packages/core/src/domains/*/ports/*.ts`, declare:
  - `export const <Name>RepositoryKind = 'crud' | 'custom' as const`
- In `apps/api/src/routes/*.ts` and `apps/api/src/domains/*/routes/*.ts`, declare:
  - `export const <Name>RouteKind = 'crud' | 'custom' as const`
- If kind is `crud`, expose full CRUD surface (`list/getById/create/update/remove`).
- If kind is `custom`, do not expose full CRUD surface.

## Enforcement
- ESLint rules: `packages/tooling/eslint-config/domain-invariants.js`.
- Structural and layering invariants are enforced in ESLint (`domain-structure/*` rules).
- Structural/runtime invariant checker: `scripts/lint/enforce-domain-invariants.mjs`.
- Shell invariant checker: `scripts/check-shell-invariants.sh`.
- Full gate: `pnpm lint` (workspace ESLint + invariant checker + shell invariants).

## Worktree + Infra Discipline
- Use `pnpm infra:ensure` (idempotent, no container teardown).
- Integration tests must run through `pnpm test:integration` (ensures infra + reset DB state).
- Integration runners are lock-guarded (`/tmp/tx-agent-kit-integration.lock`); avoid launching overlapping integration commands manually.
- DB trigger contracts are validated with pgTAP via `pnpm test:db:pgtap` (also included in integration quiet/full runners).
- Scaffold custom triggers with `pnpm db:trigger:new --name <trigger-name> --table <table> ...`.
- Derive deterministic worktree ports with `pnpm worktree:ports <name>`.
- For local setup, prefer `pnpm env:configure` over hand-editing `.env`.

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
