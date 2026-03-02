# Quality

- Enforce package boundaries with ESLint.
- Enforce structured logging with `no-console` + `@<domain>/logging`.
- Keep tests idempotent and deterministic.
- Run unit tests via `pnpm test`.
- Run integration tests against Docker infra via `pnpm test:integration`.
- Integration suites execute via one root Vitest workspace run (`vitest.integration.workspace.ts`) with shared global setup.
- Unit suites run with host-CPU parallelism by default (`TEST_MAX_WORKERS` to override).
- Integration suites run with host-CPU parallelism by default (`INTEGRATION_MAX_WORKERS` to override).
- Web integration can be independently capped with `WEB_INTEGRATION_MAX_WORKERS` and continues to use pool-slot isolated API ports/schemas.
- Web integration harnesses keep one API process per pool slot warm across test files; resets happen per test case.
- Integration DB reset is lock-guarded (`/tmp/<domain>-db-reset.lock`) to avoid concurrent local test clobbering.
- Full integration runners are lock-guarded (`/tmp/<domain>-integration.lock`) to prevent concurrent suite interference.
- Run database contract suites via `pnpm test:db:pgtap`.
- API integration harness is standardized via `createDbAuthContext(...)` (no manual process spawning in API integration suites).
- API harness callers must resolve `apiCwd` via `fileURLToPath(import.meta.url)` (never `process.cwd()`), so root-workspace integration runs stay deterministic.
- Run invariant checks via `pnpm lint` (`eslint` + `scripts/lint/enforce-domain-invariants.mjs` + `scripts/lint/enforce-web-client-contracts.mjs` + `scripts/lint/enforce-route-kind-contracts.mjs` + `scripts/lint/enforce-source-type-safety.mjs` + `scripts/lint/enforce-compose-runtime-contracts.mjs` + `scripts/lint/enforce-tsconfig-alignment.mjs` + `scripts/lint/enforce-domain-event-contracts.mjs` + shell invariants).

## Domain Invariants

- API-first web: `apps/web` never imports `@<domain>/db` or `drizzle-orm`.
- Web runtime simplicity: `apps/web` must not import `effect`/`effect/*`; keep Effect runtime logic in API/core/worker layers.
- Client-only web runtime: no `apps/web/app/api`, no web proxy/middleware runtime files, and no `next/server`/`next/headers` imports.
- Client component contract: all `apps/web/app/**/*.tsx` and `apps/web/components/**/*.tsx` start with `'use client'`.
- Web storage contract: only `apps/web/lib/auth-token.ts` can touch `localStorage`.
- Web transport contract: `apps/web/lib` must not use `/api/*` proxy paths; use `API_BASE_URL`.
- Web URL-state contract: `nuqs` usage is centralized in `apps/web/lib/url-state.tsx`.
- Web notifications contract: `sonner` usage is centralized in `apps/web/lib/notify.tsx`.
- Web browser API contract: direct `window.location` access is forbidden; use URL-state wrappers.
- Web transport discipline: direct `fetch` in `apps/web` is forbidden; use typed clients.
- Logging discipline: `console.*` is banned; use `@<domain>/logging`.
- Drizzle isolation: only `packages/infra/db` imports `drizzle-orm`.
- Schema-first boundaries: domain request/response validation is done with `effect/Schema` (zod is banned).
- Table schema parity: each database table has a corresponding Effect schema under `packages/infra/db/src/effect-schemas/`.
- JSON column typing governance: every Drizzle `json/jsonb` column must call `.$type<...>()`, and matching Effect row-schema fields must be explicit typed schemas (not `Schema.Unknown`/`Schema.Json`).
- Table factory parity: each database table has a corresponding factory under `packages/infra/db/src/factories/`.
- Contract governance: `apps/api/openapi.json` is generated from `apps/api` and carries closed DDD invariants (`x-ddd` + per-route `x-invariants`).
- Kind governance: repository ports and API routes must explicitly declare `crud` or `custom` markers, and marker claims must match actual surface area.
- Core domain folder contract: `packages/core/src/domains/*` must use `domain/ports/application/adapters` and must not contain `repositories/` or `services/`.
- Persistence boundary contract: core `ports/` are abstract repository seams; concrete persistence implementations live only in `packages/infra/db/src/repositories/`.
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
- Test-only governance: `.only()` in test files is forbidden (`no-only-tests/no-only-tests`); a committed `.only()` silently skips the rest of the suite in CI.
- Dead import governance: unused imports are auto-removed (`unused-imports/no-unused-imports`).
- Modern JS governance: curly braces required on all blocks; object shorthand, arrow callbacks, rest params, and spread are enforced.
- Unicorn governance: `node:` protocol for builtins, `.replaceAll()` over `.replace(/…/g)`, `.slice()` over `.substring()`/`.substr()`, `.flatMap()` over `.map().flat()`, `.some()` over `.filter().length`, `structuredClone` over JSON round-trip, `Number.*` properties over globals (`isNaN`, `isFinite`, `parseInt`, `parseFloat`), consistent `error` naming in catch blocks, numeric separators for large literals, no redundant spreads, no useless `Promise.resolve/reject` in async functions, drop unused catch bindings.
- Constant expression governance: provably-wrong binary expressions are forbidden (`no-constant-binary-expression`).
- Test colocation governance: `__tests__` folders, `.spec.ts[x]`, and `.integration.ts[x]` names are forbidden; use colocated `<file>.test.ts[x]` and `<file>.integration.test.ts[x]`.
- Critical integration baseline governance:
  - API integration suite must exercise health/auth/organization/invitation endpoints and invitation idempotency.
  - API integration suite must include a health readiness latency assertion.
  - Web integration suites must cover `DashboardPage`, `OrganizationsPage`, `InvitationsPage`, `AuthForm`, `CreateOrganizationForm`, `CreateInvitationForm`, `AcceptInvitationForm`, `SignOutButton`, `ForgotPasswordForm`, `ResetPasswordForm`, and `client-auth` guard logic.
  - Dashboard integration must assert unauthenticated redirect to `/sign-in?next=%2Fdashboard`.
  - Organizations/Invitations integrations must assert unauthenticated redirect contracts (`/sign-in?next=%2Forganizations` and `/sign-in?next=%2Finvitations`).
  - Dashboard/Organizations/Invitations integrations must also assert invalid-token handling (401 -> clear session -> redirect).
  - Organizations/Invitations integrations must also cover authenticated data-loading paths (seed users/teams/invites and assert rendered state).
  - Web integration suite lifecycle is centralized in `apps/web/vitest.integration.setup.ts` (test files must not call setup/reset/teardown directly).
  - Worker integration suite must cover idempotent `activities.processOperation(...)` behavior against SQL (`alreadyProcessed: false -> true`).
- Trigger contract governance: each SQL `CREATE TRIGGER` in DB migrations must be referenced by pgTAP suites in `packages/infra/db/pgtap/*.sql`.
- Integration orchestration governance: root workspace config (`vitest.integration.workspace.ts`) and root global setup (`scripts/test/vitest-global-setup.ts`) are required; package-level integration configs (api/testkit/worker) must not define infra-level `globalSetup`.

## Domain Event Invariants

- Event type registry: all dot-separated event types used in `eventType:`, `case`, or `=== '...'` patterns must be registered in `domainEventTypes` in `packages/contracts/src/literals.ts`.
- Event payload interface parity: each registered event type must have `export interface <Type>EventPayload` in `packages/core/src/domains/<aggregate>/domain/*-events.ts`.
- Event payload schema parity: each registered event type must have `export const <Type>EventPayloadSchema` in `packages/temporal-client/src/types/*.ts`.
- Transactional write enforcement: domain event inserts in repositories must be inside a `db.transaction()` or use a `trx` handle.
- Handler completeness: every registered event type must have a `case '...'` in `apps/worker/src/workflows*.ts`.
- Idempotent workflow IDs: every `startChild`/`executeChild` call must include a `workflowId` property containing `event.id`.
- No payload `as` casts: `.payload as <Type>` is forbidden in worker source; use Schema decode.
- Event type naming convention: strings must match `^[a-z][a-z_]*\.[a-z][a-z_]*$`.
- Retention settings completeness: every table in `retentionTableNames` must appear in the `retention_settings` migration seed.
- Domain event insert helper: inline `.insert(domainEvents).values(...)` outside `repositories/domain-events.ts` is banned; use `insertDomainEventInTransaction`.
- Naming derivation: the enforcement script derives names via dot-split PascalCase (e.g., `organization.created` → `OrganizationCreatedEventPayload` / `OrganizationCreatedEventPayloadSchema`).

## Web Route Group Governance

- `apps/web/app/(website)/` contains public marketing pages (landing, blog, pricing, terms, privacy) served under the `WebsiteHeader`/`WebsiteFooter` layout.
- `apps/web/app/(application)/` contains authenticated app pages behind an auth-guard layout.
- Auth pages (`sign-in`, `sign-up`, `forgot-password`, `reset-password`) live at the app root, outside both route groups.
- All marketing pages use `apps/web/config/index.ts` for config-driven content.
- SEO utilities in `apps/web/lib/seo.ts` and `apps/web/lib/blog-seo.ts` generate JSON-LD structured data.
- Blog data layer in `apps/web/lib/blog.ts` uses a pluggable `BlogDataSource` interface — backend-agnostic.
- `apps/web/components/Breadcrumbs.tsx` provides breadcrumb navigation.
- `apps/web/components/StructuredData.tsx` renders JSON-LD `<script>` tags.

## DDD Layer Direction

- `domain` imports only `domain`.
- `ports` imports only `domain|ports`.
- `application` imports only `domain|ports|application|self`.
- `adapters` import only `domain|ports|adapters|self`.
- `runtime|ui` are orchestration/presentation layers and must not invert dependencies back into persistence concerns.
