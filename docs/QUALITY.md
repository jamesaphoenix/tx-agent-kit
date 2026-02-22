# Quality

- Enforce package boundaries with ESLint.
- Enforce structured logging with `no-console` + `@tx-agent-kit/logging`.
- Keep tests idempotent and deterministic.
- Run unit tests via `pnpm test`.
- Run integration tests against Docker infra via `pnpm test:integration`.
- Integration suites execute via one root Vitest workspace run (`vitest.integration.workspace.ts`) with shared global setup.
- Non-web integration suites run with configurable parallelism (`INTEGRATION_MAX_WORKERS`, default `2`).
- Web integration suites run with multi-worker Vitest by default (`WEB_INTEGRATION_MAX_WORKERS=3`) with pool-slot isolated API ports/schemas.
- Worker integration is intentionally single-worker (`maxWorkers: 1`) because it validates Effect-driven writes against deterministic public-schema resets.
- Web integration harnesses keep one API process per pool slot warm across test files; resets happen per test case.
- Integration DB reset is lock-guarded (`/tmp/tx-agent-kit-db-reset.lock`) to avoid concurrent local test clobbering.
- Full integration runners are lock-guarded (`/tmp/tx-agent-kit-integration.lock`) to prevent concurrent suite interference.
- Run database contract suites via `pnpm test:db:pgtap`.
- API integration harness is standardized via `createDbAuthContext(...)` (no manual process spawning in API integration suites).
- API harness callers must resolve `apiCwd` via `fileURLToPath(import.meta.url)` (never `process.cwd()`), so root-workspace integration runs stay deterministic.
- Run invariant checks via `pnpm lint` (`eslint` + `scripts/lint/enforce-domain-invariants.mjs`).

## Domain Invariants

- API-first web: `apps/web` never imports `@tx-agent-kit/db` or `drizzle-orm`.
- Web runtime simplicity: `apps/web` must not import `effect`/`effect/*`; keep Effect runtime logic in API/core/worker layers.
- Client-only web runtime: no `apps/web/app/api`, no web proxy/middleware runtime files, and no `next/server`/`next/headers` imports.
- Client component contract: all `apps/web/app/**/*.tsx` and `apps/web/components/**/*.tsx` start with `'use client'`.
- Web storage contract: only `apps/web/lib/auth-token.ts` can touch `localStorage`.
- Web transport contract: `apps/web/lib` must not use `/api/*` proxy paths; use `API_BASE_URL`.
- Web URL-state contract: `nuqs` usage is centralized in `apps/web/lib/url-state.tsx`.
- Web notifications contract: `sonner` usage is centralized in `apps/web/lib/notify.tsx`.
- Web browser API contract: direct `window.location` access is forbidden; use URL-state wrappers.
- Web transport discipline: direct `fetch` in `apps/web` is forbidden; use typed clients.
- Logging discipline: `console.*` is banned; use `@tx-agent-kit/logging`.
- Drizzle isolation: only `packages/db` imports `drizzle-orm`.
- Schema-first boundaries: domain request/response validation is done with `effect/Schema` (zod is banned).
- Table schema parity: each database table has a corresponding Effect schema under `packages/db/src/effect-schemas/`.
- Table factory parity: each database table has a corresponding factory under `packages/db/src/factories/`.
- Contract governance: `apps/api/openapi.json` is generated from `apps/api` and carries closed DDD invariants (`x-ddd` + per-route `x-invariants`).
- Kind governance: repository ports and API routes must explicitly declare `crud` or `custom` markers, and marker claims must match actual surface area.
- Domain legibility governance: domain layer files use named exports only (no default exports).
- Source hygiene governance: TODO/FIXME/HACK comments are forbidden in source modules.
- Domain determinism governance: no direct `Date.now`, `new Date`, or `Math.random` in domain-layer paths.
- Temporal workflow determinism governance: native timer calls (`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`) are forbidden in workflows.
- Env governance: `apps/web` and `apps/worker` must read runtime env through dedicated env modules, not scattered `process.env` usage.
- Source env governance: `apps/**/src` and `packages/**/src` read env only through dedicated env modules (`apps/api/src/config/*`, `apps/worker/src/config/env.ts`, `packages/*/src/env.ts`).
- Suppression governance: source modules must not contain `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` directives.
- Type-safety governance: `as any` assertions are forbidden in source modules.
- Type-safety governance: chained assertions (`as unknown as ...`) are forbidden in source modules.
- Error-handling governance: empty catch blocks are forbidden in source modules.
- Test colocation governance: `__tests__` folders, `.spec.ts[x]`, and `.integration.ts[x]` names are forbidden; use colocated `<file>.test.ts[x]` and `<file>.integration.test.ts[x]`.
- Critical integration baseline governance:
  - API integration suite must exercise health/auth/workspace/task/invitation endpoints and invitation idempotency.
  - API integration suite must include a health readiness latency assertion.
  - Web integration suites must cover `DashboardPage`, `WorkspacesPage`, `InvitationsPage`, `AuthForm`, `CreateWorkspaceForm`, `CreateTaskForm`, `CreateInvitationForm`, `AcceptInvitationForm`, `SignOutButton`, and `client-auth` guard logic.
  - Dashboard integration must assert unauthenticated redirect to `/sign-in?next=%2Fdashboard`.
  - Workspaces/Invitations integrations must assert unauthenticated redirect contracts (`/sign-in?next=%2Fworkspaces` and `/sign-in?next=%2Finvitations`).
  - Dashboard/Workspaces/Invitations integrations must also assert invalid-token handling (401 -> clear session -> redirect).
  - Workspaces/Invitations integrations must also cover authenticated data-loading paths (seed users/teams/invites and assert rendered state).
  - Web integration suite lifecycle is centralized in `apps/web/vitest.integration.setup.ts` (test files must not call setup/reset/teardown directly).
  - Worker integration suite must cover idempotent `activities.processTask(...)` behavior against SQL (`alreadyProcessed: false -> true`).
- Trigger contract governance: each SQL `CREATE TRIGGER` in DB migrations must be referenced by pgTAP suites in `packages/db/pgtap/*.sql`.
- Integration orchestration governance: root workspace config (`vitest.integration.workspace.ts`) and root global setup (`scripts/test/vitest-global-setup.ts`) are required; package-level integration configs (api/testkit/worker) must not define infra-level `globalSetup`.

## DDD Layer Direction

- `domain` imports only `domain`.
- `ports` imports only `domain|ports`.
- `repositories|adapters` import only `domain|ports|self`.
- `services` import only `domain|ports|repositories|adapters|self`.
- `runtime|ui` are orchestration/presentation layers and must not invert dependencies back into persistence concerns.
