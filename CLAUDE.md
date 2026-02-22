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
- Do not import `effect`/`effect/*` from `apps/web`; keep web as a dumb API consumer.
- Keep `apps/web` strictly client-only: no `app/api` routes, no `proxy.ts`/`middleware.ts`, and no `next/server`/`next/headers`.
- Every file in `apps/web/app/**/*.tsx` and `apps/web/components/**/*.tsx` must start with `'use client'`.
- Only `apps/web/lib/auth-token.ts` may read/write `localStorage`.
- `apps/web/lib` must not use `/api/*` proxy paths; all web transport goes directly to `API_BASE_URL`.
- Use `apps/web/lib/url-state.tsx` as the only entry-point for URL query state; do not import `nuqs` directly elsewhere.
- Use `apps/web/lib/notify.tsx` as the only entry-point for notifications; do not import `sonner` directly elsewhere.
- Do not read `window.location` directly in `apps/web`; parse URL state via `apps/web/lib/url-state.tsx`.
- Do not use direct `fetch` in `apps/web`; use typed API client layers.
- Keep `apps/api/openapi.json` generated from `apps/api` (`pnpm openapi:generate`).
- Keep web API hooks generated from API spec (`pnpm api:client:generate`).
- Maintain table-to-schema parity in `packages/db/src/effect-schemas`.
- Maintain table-to-factory parity in `packages/db/src/factories`.
- Enforce explicit route/repository kind markers (`crud` vs `custom`) and keep them consistent.
- Domain layer files must use named exports only (no default exports).
- Source hygiene: TODO/FIXME/HACK comments are disallowed in source modules.
- Domain determinism: no direct `Date.now`, `new Date`, or `Math.random` in domain-layer code; inject via ports.
- Use `@tx-agent-kit/logging` for structured logs (`console.*` is lint-banned).
- MCP servers are started via project wrappers in `scripts/mcp/*` (configured by `.mcp.json`), not ad hoc commands.
- Domain/services/routes/workflows must not read `process.env` directly; use typed config modules/layers.
- Web runtime env reads are centralized in `apps/web/lib/env.ts`; worker runtime env reads are centralized in `apps/worker/src/config/env.ts`.
- Source env policy: `apps/**/src` and `packages/**/src` must read runtime env through dedicated env modules only.
- `as any` assertions are forbidden in source modules; model unknowns explicitly and decode with schema at boundaries.
- Chained assertions (`as unknown as ...`) are forbidden in source modules.
- Avoid `Effect.run*` in source modules except explicit runtime boundaries.
- Temporal workflows must be deterministic (no `Date.now`, `new Date`, `Math.random`, or infra imports).
- Temporal workflows must not call native timers (`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`) directly.
- Empty catch blocks are forbidden in source modules; handle, classify, or rethrow errors.
- Source suppression directives are forbidden in app/package source (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`) outside generated/test paths.
- Test structure is colocated-only: `__tests__` directories, `.spec.ts[x]`, and `.integration.ts[x]` files are disallowed. Use `<file>.test.ts[x]` and `<file>.integration.test.ts[x]`.
- API integration harness is standardized: `apps/api/src/api.integration.test.ts` must use `createDbAuthContext(...)` (no manual process spawning or direct `createSqlTestContext(...)` wiring).
- Critical-flow integration baseline is enforced:
  - API coverage includes `/v1/auth/sign-up`, `/v1/auth/sign-in`, `/v1/auth/me`, `/v1/workspaces`, `/v1/tasks`, `/v1/invitations`, plus invitation idempotency.
  - Web coverage includes `AuthForm`, `CreateWorkspaceForm`, `CreateTaskForm`, `CreateInvitationForm`, `AcceptInvitationForm`, and `SignOutButton` integration suites.

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
Golden path for CRUD domain setup:
- `pnpm scaffold:crud --domain <domain> --entity <entity> --dry-run`
- `pnpm scaffold:crud --domain <domain> --entity <entity>`
- Skill reference: `skills/golden-path-crud/SKILL.md` (also mirrored in `.claude/skills/golden-path-crud/SKILL.md` and `.codex/skills/golden-path-crud/SKILL.md`)

1. Add/extend contracts in `packages/contracts` with `effect/Schema`.
2. Add domain logic under `packages/core/src/domains/<domain>/...`.
3. If persistence changes, update `packages/db/src/schema.ts` and matching `packages/db/src/effect-schemas/*.ts`.
4. Add/update matching table factory in `packages/db/src/factories/*.factory.ts`.
4.5. For DB triggers, scaffold using `pnpm db:trigger:new ...` and keep pgTAP coverage referencing trigger names.
5. Expose API behavior from `apps/api`, then regenerate OpenAPI.
6. Regenerate web API hooks from OpenAPI when API contract changes.
7. Run `pnpm lint && pnpm type-check && pnpm test`.

## Mechanical Enforcement
- ESLint restrictions live in `packages/tooling/eslint-config/domain-invariants.js`.
- Structural checks live in `scripts/lint/enforce-domain-invariants.mjs`.
- Shell checks live in `scripts/check-shell-invariants.sh`.
- `pnpm lint` executes ESLint + structural invariants + shell invariants.

## Infra + Test Reliability
- Use `pnpm env:configure` to seed `.env` idempotently.
- Use `pnpm infra:ensure` to start shared local infrastructure across worktrees.
- Use `pnpm test:integration` for integration suites (idempotent DB reset + no container teardown).
- Integration runners are lock-guarded (`/tmp/tx-agent-kit-integration.lock`) to prevent overlapping commands from clobbering each other.
- Use `pnpm test:db:pgtap` to validate database trigger contracts (included by integration quiet/full scripts).
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
