**IMPORTANT**: `CLAUDE.md` and `AGENTS.md` are symlinked — they share the same content. When making
changes, always update `AGENTS.md` (the source) so both files stay in sync.

Agent-first starter for Effect HTTP + Temporal + Next.js + Drizzle.

This repository uses an agent-first workflow inspired by OpenAI's Harness Engineering post (February 11, 2026).

## Operating Model
- Humans steer intent and acceptance criteria.
- Agents implement, validate, and iterate with mechanical checks.
- If an agent fails repeatedly, improve scaffolding (docs, linters, tests, scripts).

## Repo Map

| Artifact | Path |
|----------|------|
| Architecture | `docs/ARCHITECTURE.md` |
| Quality invariants | `docs/QUALITY.md` |
| Command catalog | `docs/COMMANDS.md` |
| Runbooks | `docs/RUNBOOKS.md` |
| Deployment | `docs/DEPLOYMENT.md` |
| Rollback | `docs/ROLLBACK.md` |
| API contract | `apps/api/openapi.json` (generated via `pnpm openapi:generate`) |
| MCP servers | `.mcp.json` + `scripts/mcp/*` |
| Skills | `.claude/skills/*` |
| CRUD scaffold skill | `.claude/skills/golden-path-crud/SKILL.md` |
| Frontend component workflow | `.claude/skills/frontend-component-workflow/SKILL.md` |
| Playwright auth skill | `.claude/skills/playwright-auth/SKILL.md` |
| Global constants | `packages/contracts/src/constants.ts` (`@tx-agent-kit/contracts`) |

## tx CLI
Run `tx` in agent shells as `source ~/.zshrc >/dev/null 2>&1; eval 'tx <subcommand> ...'`.

## Stack
- `apps/web`: Client-only Next.js SPA (no SSR, no `app/api`)
- `apps/api`: Effect HttpApi server
- `apps/worker`: Temporal worker + workflows
- `apps/mobile`: Expo React Native
- `apps/docs`: Fumadocs documentation site
- `packages/core`: DDD domain logic (Effect services)
- `packages/contracts`: Shared schemas + event types + permissions
- `packages/temporal-client`: Temporal workflow types + event schemas
- `packages/infra/*`: DB, auth, logging, observability, AI
- `packages/testkit`: Test utilities + integration harness
- `packages/tooling/*`: ESLint configs, scaffold CLI, tsconfig, vitest configs

## DDD Structure

```txt
packages/core/src/domains/<domain>/
  events.ts       # PUBLIC cross-domain event contract (the only importable file)
  domain/         # entities, value objects, pure rules, event payloads
  ports/          # capability contracts (repository seams)
  application/    # use-case orchestration
  adapters/       # external system adapters (optional)
  runtime/        # layer wiring (optional)
```

Dependency direction: inward only (`domain ← ports ← application ← adapters ← runtime`).
Full layer rules: `docs/ARCHITECTURE.md` + `docs/QUALITY.md`.
Domain layer guide: `packages/core/CLAUDE.md`

## Cross-Domain Boundaries

**Events are public nouns. Ports are public verbs. Errors are private semantics.**

| What | Cross-domain? | How |
|------|--------------|-----|
| Domain events | Yes — via `events.ts` | The ONLY cross-domain import between sibling domains |
| Ports | No — wired through DI | Adapters bridge repos to ports; services depend on their own ports |
| Domain errors | No — translate at seams | Rich typed errors inside a domain; translate at port/app boundary |
| Shared infra errors | Yes — via `errors.ts` | `CoreError` (`unauthorized`, `notFound`, etc.) at core package level |

### Event contracts (`events.ts`)
- Lives at domain root: `packages/core/src/domains/<domain>/events.ts`
- Contains: event type discriminants, typed payload shapes, version constants
- Other domains import ONLY `type` from this file — never internal services/repos/domain logic
- ESLint + structural lint enforce this (exemption only for `/events.ts` at domain root)

### Error architecture
- **Inside a domain**: use rich typed ADT errors (`Either<Result, DomainError>`)
- **At port boundaries**: translate to seam-specific error types that don't leak internals
- **At application layer**: compose and remap into `CoreError`
- **At API layer**: final translation to HTTP via `mapCoreError`
- **Never** import another domain's internal error types

## Key Boundaries

All invariants are mechanically enforced via `pnpm lint`.
Read `docs/QUALITY.md` for the full list. Highlights:
- `apps/web` is client-only: no `effect`, no `drizzle-orm`, no `next/server`, no `app/api`.
- `apps/web` uses **Tailwind CSS + shadcn/ui** exclusively. No custom CSS in `globals.css` for new components. Use Tailwind utility classes and shadcn components (`@/components/ui/*`). Reference: https://ui.shadcn.com/ and https://tailwindcss.com/
- For normal `apps/web` runtime API access, prefer the generated Orval hooks/functions in `apps/web/lib/api/generated/*`. Reserve `apps/web/lib/client-api.ts` for auth/session bootstrap, sign-in/sign-out side effects, and imperative test/setup helpers unless a documented exception exists.
- `drizzle-orm` only in `packages/infra/db`.
- `process.env` only through dedicated env modules.
- `as any`, `@ts-ignore`, `eslint-disable` forbidden in source.
- Temporal workflows must be deterministic.
- Domain events flow through transactional outbox; `apps/api/` must not import `@temporalio/*`.
- `usage_records`/`credit_ledger` are financial audit trails — no retention policies.
- `apps/web` UI components use **shadcn/ui** primitives. Prefer shadcn components over hand-rolled HTML/CSS for all new UI work.
- All styled action buttons must use explicit `.btn` / `.btn.secondary` / `.btn.danger` classes — never rely on bare `<button>` for styled appearance.

## New Feature Workflow

1. `pnpm scaffold:crud --domain <domain> --entity <entity> --dry-run`
2. Add contracts in `packages/contracts` with `effect/Schema`.
3. Add domain logic under `packages/core/src/domains/<domain>/`.
4. If persistence: update `packages/infra/db/src/schema.ts` + effect-schemas + factories.
5. Expose via `apps/api`, then `pnpm openapi:generate`.
6. Regenerate hooks: `pnpm api:client:generate`.
7. Validate: `pnpm lint && pnpm type-check && pnpm test`.

Full skill: `.claude/skills/golden-path-crud/SKILL.md`

## Quality Gates (prefer quiet runners)
- `pnpm lint:quiet` / `pnpm lint`
- `pnpm type-check:quiet` / `pnpm type-check`
- `pnpm test:quiet` / `pnpm test`
- Local integration verification: use `pnpm test:integration:quiet` by default.
- `pnpm test:integration` is available for non-quiet debugging when you need full output.
- CI-only integration verification: `pnpm test:integration:full` and `pnpm test:integration:ci-only`.
  Do not run these locally unless the user explicitly asks; they include slow command-entrypoint/start-dev-services suites.
- `pnpm test:db:pgtap` for database trigger contracts.

- Always use `/verify-invariants` to identify spec coverage gaps before writing tests.
- Always run `tx` commands from the **main repo root**, not from worktrees. The `.tx/` state directory lives in the main repo — worktrees can't see registered docs.
- When piping a test/lint script through `grep`/`head`/`tail`, the non-zero exit code of the first command is discarded by the shell — use `set -o pipefail` in bash `command` arguments, or capture the exit code before piping, to avoid silently treating failed runs as green.

Full command catalog: `docs/COMMANDS.md`

## Integration Test Performance Budget

Integration tests enforce a **120s wall-clock budget** locally. If exceeded, the runner
kills vitest and reports slow tests (>10s). Individual test timeout is **30s locally**,
**60s in CI** (set `CI=true`).

**Infrastructure is shared across worktrees.** Docker containers start once via
`pnpm infra:ensure` and persist. The health check returns instantly when infra is already
up (`"Infrastructure already healthy (shared across worktrees)"`). Never tear down infra
during dev — it costs 20s to restart.

**Local target:** the default `pnpm test:integration:quiet` suite should stay around
30-40s on a warm machine. If it drifts materially above that, profile/split the slow
test before adding more coverage.

**Slow test suites** (command-entrypoints, start-dev-services) are excluded from the
default integration run. They run only in CI via `INTEGRATION_INCLUDE_CI_ONLY=1`,
`pnpm test:integration:full`, or `pnpm test:integration:ci-only`; do not use them as
the normal local verification gate.

| Env var | Default (local) | CI | Purpose |
|---------|-----------------|-----|---------|
| `INTEGRATION_TIMEOUT_SECONDS` | 120 | 300 | Wall-clock budget for vitest |
| `SLOW_TEST_THRESHOLD_MS` | 10000 | 10000 | Report tests slower than this |
| `INTEGRATION_TEST_TIMEOUT_MS` | 30000 | 60000 | Per-test timeout |
| `INTEGRATION_INCLUDE_CI_ONLY` | unset | 1 | Include command-entrypoints + start-dev-services |
| `DB_POOL_MAX` | 20 | 20 | Postgres pool size (5 in test harness) |

## Sentry Spotlight (Local Dev Observability)
- Starts automatically with `pnpm infra:ensure` (part of the `infra` Docker profile).
- Enabled by default: `SENTRY_SPOTLIGHT=true` in `.env.example`. Works without a real Sentry DSN (uses placeholder `https://spotlight@local/0`).
- Native desktop app alternative: download from https://spotlightjs.com/, then stop the Docker container to free port `8969`.
- All three app layers (web, api, worker) forward errors + traces to Spotlight when enabled.
- MCP server `spotlight-local` exposes `search_errors`, `search_logs`, `search_traces`, `get_traces` for AI-assisted debugging. Fails fast with a clear message if the sidecar is not running.
- `pnpm dev:open` opens the Spotlight UI alongside other dashboards.
- Full docs: `apps/docs/content/docs/observability/spotlight.mdx`.

## Mechanical Enforcement
- ESLint: `packages/tooling/eslint-config/` (modular configs)
- Structural: `scripts/lint/enforce-*.mjs` (7 invariant scripts)
- Shell: `scripts/check-shell-invariants.sh`
- DB contracts: pgTAP suites in `packages/infra/db/pgtap/`
- Duplication: `.jscpd.json` (5% threshold on api/core/scripts)
- Unused deps: `.knip.jsonc` (`pnpm lint:knip`)
- `pnpm lint` runs ESLint + structural + shell + jscpd.

## Repository Knowledge Discipline
- Keep this file short and map-like (~100 lines).
- Move durable decisions into versioned docs/code.
- Treat in-repo artifacts as the only reliable knowledge source for agents.

<tx-pin id="openrouter-strategy">
**OpenRouter-first AI routing**: All text generation, structured outputs, image generation, and embeddings go through OpenRouter. Cost is derived directly from OpenRouter's response and mapped into our CostResult type. Custom credit calculations only needed for non-OpenRouter providers (fal.ai, Veo3 video generation, ElevenLabs audio). This massively simplifies the Credit Service.
</tx-pin>

## Local Development Startup

**Always use `pnpm dev` to start the full development environment.** Never start services manually with inline env vars.

```bash
# Full stack (infra + API + web + worker)
pnpm dev

# What it does (scripts/dev.sh):
# 1. Sources .env (secrets via op:// references)
# 2. pnpm infra:ensure — docker-compose up (Postgres, Redis, OTEL, Jaeger, etc.)
# 3. pnpm temporal:dev:up — starts Temporal dev server
# 4. turbo run dev --parallel — starts API (8080), web (3000), worker

# Individual services (infra must be running first):
pnpm dev:api    # API only (port 8080)
pnpm dev:web    # Web only (port 3000)
pnpm dev:worker # Worker only

# Infrastructure only:
pnpm infra:ensure
```

### Dev Utils Login Shortcut

When the local web app is running, agents can use the dev-only **Custom dev utils** launcher to create a fresh logged-in session without manually signing up or going through Stripe checkout.

```bash
playwright-cli open http://localhost:3000
playwright-cli snapshot
# Click "Open developer utilities", then choose one of:
# - "Fresh free org"
# - "Fresh Pro + $20 local credit"
```

Use this for browser inspection, screenshots, and UI polish runs when a logged-in org/workspace is needed. Prefer the Pro + credit preset when testing billing-gated features. The helper creates a unique email, organization, workspace, signs the browser into that account, and navigates into the app.

**Rules:**
- **Never start services with inline env vars** (e.g. `DATABASE_URL=... pnpm dev:api`). Use `.env` + `op inject`.
- **Never skip Docker infrastructure.** All services depend on Postgres, Redis, and OTEL.
- **Always run `pnpm infra:ensure`** before integration tests or dev servers.
- When taking screenshots or testing UI, start the full stack with `pnpm dev` first.
- **If the dev server is not running, start it.** Don't ask whether to start it — just run `pnpm dev` (or `pnpm dev:api` / `pnpm dev:web` for individual services). The user expects services to be running when needed.

## Memories
- [Integration tests with media](docs/memories/integration-tests-with-media.md) — R2 credentials for CI media upload tests

## Test Policy

### TDD First
- **Follow TDD for all new features.** Write failing tests first, then build the code to make them pass.
- TDD forces explicit specification of functionality and aligns with our spec-driven development workflow.
- For React pages/components: write `*.integration.test.tsx` files that import the component, define the expected behavior, and fail because the component doesn't exist yet. Then build the component.

### Test Hierarchy (in order of preference)
1. **Integration tests** — primary verification mechanism. Test real API + DB + component interactions. Use `*.integration.test.tsx` for React, `*.integration.test.ts` for API.
2. **Property-based tests** — for domain logic with many edge cases (validation rules, state machines, financial calculations). Use with integration infrastructure where possible.
3. **Unit tests** — only where integration tests are impractical (pure functions, formatters, validators). Secondary to integration tests.
4. **E2E / Playwright tests** — avoid for regular development. Use only for critical user journeys that span multiple pages (sign-up → onboarding → dashboard). Prefer React integration tests with `renderWithProviders` over Playwright for component-level testing.

### React Component Testing
- **Prefer `renderWithProviders` + real API backend** over Playwright browser tests. Faster, more deterministic, tests actual React rendering.
- Inject auth directly via `writeAuthToken(token)` — no need to navigate to sign-in page.
- Use `createWebFactoryContext()` + `createUser`/`createOrganization` from testkit to seed data.
- Use `screen.getByRole`, `screen.findByText`, `waitFor` from testing-library — not CSS selectors.

### Infrastructure
- **Never skip tests.** All integration tests must run with full infrastructure (Postgres, Redis, OTEL, etc.).
- **Never skip infrastructure.** Use `pnpm infra:ensure` before running integration tests.
- Kill stale test servers (`lsof -ti :4100 | xargs kill -9`) between test runs if port conflicts occur.
- Feed test results to tx: `vitest run --reporter=json | tx spec batch --from vitest`

### Integration Test Architecture

**How it works:** Each test suite spawns its own API server as a child process and gets an isolated Postgres schema. Schema isolation means parallel test suites don't interfere with each other.

**Key entry point:** `createDbAuthContext(options)` from `@tx-agent-kit/testkit`
```typescript
const ctx = createDbAuthContext({
  apiCwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  host: '127.0.0.1',
  port: 4101,                    // unique per test file
  authSecret: 'integration-auth-secret-minimum-32-chars',
  corsOrigin: 'http://localhost:3000',
  sql: { schemaPrefix: 'mytest' } // isolated Postgres schema
})

beforeAll(() => ctx.setup())     // create schema, migrate, start API
beforeEach(() => ctx.reset())    // TRUNCATE all tables
afterAll(() => ctx.teardown())   // stop API, DROP SCHEMA
```

**Factories** (from `@tx-agent-kit/testkit`):
- `createUser(ctx)` → `{ token, refreshToken, user, credentials }`
- `createUserWithOrg(ctx)` → `{ token, org, user }`
- `createInvitation(ctx, opts)` → invitation record
- `createOrganization(ctx, opts)` → org record
- `asUser(ctx, session)` → authenticated HTTP client with `.get()`, `.post()`, `.patch()`, `.delete()`

**Port allocation:**

| Test type | Port(s) | Env var override |
|-----------|---------|------------------|
| API integration | 4100 | `API_INTEGRATION_TEST_PORT` |
| Web slot 1 | 4101 | `WEB_INTEGRATION_API_PORT` (base) |
| Web slot 2 | 4111 | stride of 10 per slot |
| Web slot 3 | 4121 | max 4 slots |
| Web slot 4 | 4131 | `WEB_INTEGRATION_MAX_WORKERS` |

Custom test files (e.g., `tenancy-model.integration.test.ts`) use their own port via `API_INTEGRATION_TEST_PORT_TENANCY=4101`.

**Web integration tests** use `createWebFactoryContext()` + `renderWithProviders()`:
```typescript
await setupWebIntegrationSuite()        // starts API per worker slot
const ctx = createWebFactoryContext()    // factory context for this slot
const user = await createUser(ctx)
writeAuthToken(user.token)              // inject auth into component
renderWithProviders(<MyPage />)
await waitFor(() => expect(screen.getByText('...')))
```

**Parallelism controls:**

| Env var | Default | Purpose |
|---------|---------|---------|
| `INTEGRATION_MAX_WORKERS` | min(CPU, 6) | API test workers |
| `WEB_INTEGRATION_MAX_WORKERS` | min(6, 4) | Web test workers |
| `TEST_MAX_WORKERS` | CPU count | Unit test workers |

**Docker infrastructure** (`pnpm infra:ensure`):
Postgres (5432), Redis (6379), Jaeger (16686), Prometheus (9090), Loki (3100), OTEL Collector (4319-4320), Grafana (3001), Spotlight (8969). Docker project name is pinned to `tx-agent-kit` across worktrees — infra is shared, never torn down per-worktree.

**Worktree parallelism:** Agents can run `pnpm type-check`, `pnpm lint`, `pnpm test`, and `pnpm test:integration` in parallel across worktrees. Each worktree's shared integration API server binds to `4100 + WORKTREE_PORT_OFFSET` (set by `scripts/worktree/setup.sh`), and each worktree gets its own Postgres schema, so there is no shared state contention. Run `./scripts/worktree/setup.sh <path>` once when creating a worktree — it seeds secrets from the primary checkout's `.env` and allocates the port offset.
